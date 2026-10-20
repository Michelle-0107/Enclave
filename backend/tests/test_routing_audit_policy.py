"""Acceptance gates must not hide a failed category or missing audit coverage."""
import unittest
from backend.tools.audit_demo_navigation import acceptance
from backend.navigation.areas import service_areas
from backend.tools.benchmark_demo_routes import CATEGORIES
from backend.tools.refresh_demo_routing import refresh_facilities
from backend.tests.test_roadside import osm_graph,p


class AuditPolicyTests(unittest.TestCase):
    def reports(self,success=30):
        return {**{name:{'summary':[{'area':a.id,'category':c,'success':success,'total':30}
                    for a in service_areas().items if a.resident_demo_supported for c in CATEGORIES]}
                   for name in ('walking-primary','walking-holdout')},
                'facilities':{'summary':[{'success':29,'total':30}]}}

    def test_overall_average_cannot_hide_a_low_category(self):
        reports=self.reports();reports['walking-primary']['summary'][0]['success']=28
        gate=acceptance(reports)
        self.assertTrue(gate['overall_strictly_above_95'])
        self.assertFalse(gate['all_walking_groups_at_least_95'])

    def test_thirty_case_categories_require_at_least_twenty_nine_successes(self):
        self.assertTrue(acceptance(self.reports(29))['all_walking_groups_at_least_95'])
        self.assertFalse(acceptance(self.reports(28))['all_walking_groups_at_least_95'])

    def test_missing_category_or_wrong_denominator_cannot_pass(self):
        reports=self.reports();reports['walking-primary']['summary'].pop()
        self.assertFalse(acceptance(reports)['all_walking_groups_at_least_95'])
        reports=self.reports();reports['walking-primary']['summary'][0]['total']=29
        self.assertFalse(acceptance(reports)['all_walking_groups_at_least_95'])
        reports=self.reports();reports['facilities']['summary']=[]
        self.assertFalse(acceptance(reports)['all_facility_groups_at_least_95'])

    def test_demo_approach_refresh_preserves_id_and_same_way_and_gap_limit(self):
        graph=osm_graph({'a':(-100,0),'b':(100,0)},[(['a','b'],{'highway':'footway'})])
        edge=graph.edges[0]
        def facility(offset):
            points=[p(-50,offset),p(50,offset)]
            return {'id':'stable-facility','routingSource':'simulation','geometry':points,
                    'anchors':[{'wayId':edge.way_id,'kind':edge.kind,'grade':list(edge.grade),'coordinate':q} for q in points]}
        original=facility(1);updated,changed,maximum=refresh_facilities(graph,[original])
        self.assertEqual(updated[0]['id'],original['id']);self.assertEqual(changed,2)
        self.assertAlmostEqual(maximum,1,places=2)
        self.assertNotEqual(updated[0]['geometry'],original['geometry'])
        with self.assertRaises(ValueError):refresh_facilities(graph,[facility(21)])
        bad=facility(1);bad['anchors'][0]['wayId']='another-road'
        with self.assertRaises(ValueError):refresh_facilities(graph,[bad])
