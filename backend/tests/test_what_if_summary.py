"""Measured, nonduplicated recommendations; isolated AI and authenticated cache."""
import asyncio
from decimal import Decimal
import io
import json
from types import SimpleNamespace as NS
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from backend.what_if.summary import comparison_facts, RepairSummaryService, SummaryNarrator
from backend.what_if.repository import WhatIfRejected


def outcome(seconds, state=None):
    return NS(state=state or ('available' if seconds is not None else 'no_route'),duration_seconds=seconds,
              distance_meters=seconds*1.2 if seconds is not None else None)


def comparison(times=(80,60),costs=(None,None),budget=None):
    baseline=[NS(path_id='p',route_mode='avoid_damage',current=outcome(100))]
    plans=[NS(id=f'plan{i}',name=f'Option {i}',total_estimated_cost_myr=Decimal(cost) if cost is not None else None,
        missing_cost_facility_ids=[] if cost is not None else ['unknown'],budget_status='unknown_cost' if cost is None else
            'not_set' if budget is None else 'within_budget' if Decimal(cost)<=Decimal(budget) else 'over_budget',
        paths=[NS(path_id='p',route_mode='avoid_damage',after=outcome(seconds),effect='shortened')])
        for i,(seconds,cost) in enumerate(zip(times,costs))]
    return NS(simulation_id=uuid4(),baseline=baseline,plans=plans,budget_myr=Decimal(budget) if budget is not None else None)


class SummaryFactsTests(unittest.TestCase):
    def test_no_prices_or_budget_ranks_only_time_and_preserves_unknown_prices(self):
        facts=comparison_facts(comparison(),'avoid_damage')
        self.assertEqual(facts.basis,'time_only')
        self.assertEqual(facts.recommended_plan_ids,['plan1'])
        self.assertEqual([p.saved_seconds for p in facts.plans],[20,40])
        self.assertTrue(all(p.cost_myr is None for p in facts.plans))

    def test_complete_costs_without_budget_use_cost_effectiveness(self):
        facts=comparison_facts(comparison(costs=('10','100')),'avoid_damage')
        self.assertEqual(facts.basis,'cost_effectiveness')
        self.assertEqual(facts.recommended_plan_ids,['plan0'])

    def test_budget_filters_over_budget_then_maximizes_time_with_cost_tie_break(self):
        facts=comparison_facts(comparison(costs=('10','100'),budget='50'),'avoid_damage')
        self.assertEqual(facts.basis,'budget_and_time')
        self.assertEqual(facts.recommended_plan_ids,['plan0'])
        self.assertEqual(comparison_facts(comparison(costs=('10','100'),budget='5'),'avoid_damage').recommended_plan_ids,[])
        tie=comparison_facts(comparison(times=(60,60),costs=('20','10'),budget='50'),'avoid_damage')
        self.assertEqual(tie.recommended_plan_ids,['plan1'])

    def test_partial_prices_are_not_zero_and_known_budget_violations_still_excluded(self):
        facts=comparison_facts(comparison(costs=(None,'100'),budget='50'),'avoid_damage')
        self.assertEqual(facts.basis,'time_only')
        self.assertEqual(facts.recommended_plan_ids,['plan0'])
        self.assertIn('cannot be confirmed',facts.explanation)
        zero=comparison_facts(comparison(costs=('0','100')),'avoid_damage')
        self.assertEqual(zero.recommended_plan_ids,['plan0'])

    def test_accessible_fallback_and_restored_routes_do_not_invent_time_savings(self):
        result=comparison()
        result.baseline.append(NS(path_id='p',route_mode='accessible',current=outcome(None,'not_assessable')))
        for plan in result.plans:
            plan.paths.append(NS(path_id='p',route_mode='accessible',after=outcome(None,'not_assessable'),effect='not_assessable'))
        facts=comparison_facts(result,'accessible')
        self.assertEqual(facts.comparable_path_count,0);self.assertEqual(facts.recommended_plan_ids,[])
        result.baseline[0].current=outcome(None)
        for plan in result.plans:plan.paths[0].effect='restored'
        facts=comparison_facts(result,'avoid_damage')
        self.assertTrue(all(p.saved_seconds==0 and p.restored_paths==1 for p in facts.plans))
        self.assertEqual(facts.recommended_plan_ids,[])

    def test_only_common_available_paths_are_summed_and_new_losses_are_not_recommended(self):
        result=comparison(times=(50,60))
        result.baseline.append(NS(path_id='extra',route_mode='avoid_damage',current=outcome(1000)))
        result.plans[0].paths.append(NS(path_id='extra',route_mode='avoid_damage',after=outcome(None),effect='lost_route'))
        result.plans[1].paths.append(NS(path_id='extra',route_mode='avoid_damage',after=outcome(1),effect='shortened'))
        facts=comparison_facts(result,'avoid_damage')
        self.assertEqual(facts.comparable_path_count,1)
        self.assertEqual([p.saved_seconds for p in facts.plans],[50,40])
        self.assertEqual(facts.recommended_plan_ids,['plan1'])


class SummaryServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_owner_role_recheck_cached_ai_and_no_geometry_or_names_sent(self):
        repo=NS(snapshot=AsyncMock())
        narrator=AsyncMock(return_value='The recommended option offers the strongest measured benefit.')
        service=RepairSummaryService(repo,narrator)
        self.addAsyncCleanup(service.close)
        result=comparison();service.remember('owner',result)
        first,second=await asyncio.gather(service.summary('owner',result.simulation_id,'avoid_damage'),
            service.summary('owner',result.simulation_id,'avoid_damage'))
        self.assertEqual(first,second);self.assertEqual(first.source,'ai')
        narrator.assert_awaited_once();self.assertEqual(repo.snapshot.await_count,2)
        with self.assertRaises(WhatIfRejected) as error:await service.summary('other',result.simulation_id,'avoid_damage')
        self.assertEqual(error.exception.status,404)
        repo.snapshot.side_effect=WhatIfRejected(403,'Management role required')
        with self.assertRaises(WhatIfRejected):await service.summary('owner',result.simulation_id,'avoid_damage')

    async def test_provider_error_or_timeout_returns_labelled_calculated_summary(self):
        async def slow(facts):await asyncio.sleep(1)
        for narrator in (AsyncMock(side_effect=RuntimeError('private error')),slow):
            service=RepairSummaryService(NS(snapshot=AsyncMock()),narrator,timeout=.01)
            self.addAsyncCleanup(service.close)
            result=comparison();service.remember('owner',result)
            summary=await service.summary('owner',result.simulation_id,'avoid_damage')
            self.assertEqual(summary.source,'calculated')
            self.assertNotIn('private error',summary.text)
            self.assertEqual(summary.facts.recommended_plan_ids,['plan1'])

    async def test_bounded_cache_expiry_and_unrequested_mode(self):
        service=RepairSummaryService(NS(snapshot=AsyncMock()),AsyncMock(),max_entries=1)
        self.addAsyncCleanup(service.close)
        first,second=comparison(),comparison()
        service.remember('owner',first);service.remember('owner',second)
        self.assertEqual(len(service.cache),1)
        with self.assertRaises(WhatIfRejected):await service.summary('owner',first.simulation_id,'avoid_damage')
        with self.assertRaises(WhatIfRejected):await service.summary('owner',second.simulation_id,'accessible')
        service.cache[str(second.simulation_id)]['expires']=0
        with self.assertRaises(WhatIfRejected):await service.summary('owner',second.simulation_id,'avoid_damage')

    async def test_concurrency_limit_and_close_cancel_inflight_work(self):
        gate=asyncio.Event()
        async def narrator(facts):await gate.wait();return 'A qualitative insight about the selected comparison.'
        service=RepairSummaryService(NS(snapshot=AsyncMock()),narrator)
        results=[comparison() for _ in range(3)]
        for result in results:service.remember('owner',result)
        requests=[asyncio.create_task(service.summary('owner',r.simulation_id,'avoid_damage')) for r in results]
        await asyncio.sleep(.01)
        self.assertLessEqual(service.inflight,2)
        self.assertIsInstance(requests[2].exception(),WhatIfRejected)
        await service.close()
        await asyncio.gather(*requests,return_exceptions=True)
        self.assertFalse(service.tasks)


class SummaryApiTests(unittest.TestCase):
    def test_summary_requires_management_and_an_owned_completed_comparison(self):
        from backend.tests.test_what_if import WhatIfTests,body
        fixture=WhatIfTests();fixture.setUp();self.addCleanup(fixture.doCleanups)
        client=fixture.client()
        result=fixture.compare(client,body()).json()
        url='/api/v1/management/what-if/'+result['simulation_id']+'/summary'
        self.assertEqual(client.post(url,json={}).status_code,401)
        self.assertEqual(client.post(url,json={},headers={'Authorization':'Bearer resident-fixture'}).status_code,403)
        response=client.post(url,json={'route_mode':'avoid_damage'},headers={'Authorization':'Bearer manager-fixture'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()['source'],'calculated')
        self.assertEqual(response.headers['cache-control'],'private, no-store')

    def test_bedrock_uses_anonymized_prompt_and_rejects_invented_numbers(self):
        from backend.what_if.summary import SummaryNarrator
        narrator=SummaryNarrator({'AWS_REGION':'us-east-1'})
        client=MagicMock()
        client.invoke_model.return_value={'body':io.BytesIO(json.dumps({'output':{'message':{'content':[
            {'text':json.dumps({'insight':'The recommended option provides the strongest measured time reduction.'})} ]}}}).encode())}
        facts=comparison_facts(comparison(),'avoid_damage')
        with patch('boto3.client',return_value=client):
            value=asyncio.run(narrator(facts))
        self.assertIn('recommended',value)
        payload=json.loads(client.invoke_model.call_args.kwargs['body'])
        self.assertNotIn('Option 0',json.dumps(payload));self.assertNotIn('plan0',json.dumps(payload))
        self.assertEqual(payload['inferenceConfig']['maxTokens'],400)
        with self.assertRaises(ValueError):SummaryNarrator.answer('{"insight":"Save 999 minutes!"}')

    def test_bedrock_failure_falls_back_to_gemini_with_only_anonymous_facts(self):
        import httpx
        original=httpx.AsyncClient
        captured=[]
        def handle(request):
            captured.append(request)
            return httpx.Response(200,json={'candidates':[{'content':{'parts':[{'text':json.dumps({
                'insight':'Prioritize the recommended option for the strongest assessed time benefit.'})}]}}]})
        def client(**options):
            return original(transport=httpx.MockTransport(handle),**options)
        narrator=SummaryNarrator({'AWS_REGION':'us-east-1','GEMINI_API_KEY':'synthetic-key'})
        facts=comparison_facts(comparison(),'avoid_damage')
        with patch.object(narrator,'bedrock',side_effect=RuntimeError('unavailable')),patch('httpx.AsyncClient',client):
            answer=asyncio.run(narrator(facts))
        self.assertIn('recommended',answer)
        self.assertEqual(len(captured),1)
        self.assertEqual(captured[0].headers['x-goog-api-key'],'synthetic-key')
        prompt=json.loads(captured[0].content)['contents'][0]['parts'][0]['text']
        for private in ('Option 0','plan0','latitude','longitude','user_id','Authorization'):
            self.assertNotIn(private,prompt)



if __name__=='__main__':unittest.main()
