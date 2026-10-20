"""Frozen legacy and walking-eligible audits. Never replace failed samples."""
import gzip
import hashlib
import json
from pathlib import Path
from backend.navigation.road_cache import signature
from backend.navigation.roadside import OPEN_ACCESS_METERS,ENDPOINT_ACCESS_METERS
from backend.tools.benchmark_demo_routes import evaluate
from backend.tools.benchmark_demo_routes import CATEGORIES
from backend.navigation.areas import service_areas

ROOT=Path(__file__).resolve().parents[1]
WALKING=('walking-primary','walking-holdout')


def acceptance(reports):
    groups=[row for name in WALKING for row in reports[name]['summary']]
    total=sum(row['total'] for row in groups);success=sum(row['success'] for row in groups)
    expected={(name,area.id,category) for name in WALKING for area in service_areas().items if area.resident_demo_supported for category in CATEGORIES}
    actual={(name,row['area'],row['category']) for name in WALKING for row in reports[name]['summary']}
    coverage=actual==expected and len(groups)==len(expected) and all(row['total']==30 for row in groups)
    return {'overall_success':success,'overall_total':total,'overall_rate':success/total if total else 0,
            'overall_strictly_above_95':bool(total and success*100>total*95),
            'all_walking_groups_at_least_95':coverage and all(row['success']*100>=row['total']*95 for row in groups),
            'all_facility_groups_at_least_95':bool(reports['facilities']['summary']) and all(row['success']*100>=row['total']*95 for row in reports['facilities']['summary'])}


def main():
    out=ROOT/'docs/api/demo-routing-audit-95';out.mkdir(parents=True,exist_ok=True)
    inputs={'random-primary':ROOT/'data/demo_areas/random-route-samples.json',
            'random-holdout':ROOT/'tests/fixtures/demo-routing/holdout-samples.json',
            'walking-primary':ROOT/'tests/fixtures/demo-routing/walking-primary-samples.json',
            'walking-holdout':ROOT/'tests/fixtures/demo-routing/walking-holdout-samples.json',
            'facilities':ROOT/'tests/fixtures/demo-routing/facility-samples.json'}
    reports={}
    for name,path in inputs.items():
        raw=path.read_bytes();result=evaluate(json.loads(raw),demo=True)
        result.update(algorithm_sha256=signature(),sample_sha256=hashlib.sha256(raw).hexdigest(),
                      demo_overlay_sha256=hashlib.sha256((ROOT/'navigation/demo_network.py').read_bytes().replace(b'\r\n',b'\n')).hexdigest(),
                      access_policy={'inferred_gap_limit_meters':OPEN_ACCESS_METERS,'outdoor_approach_limit_meters':ENDPOINT_ACCESS_METERS,
                      'building_access':'nearest usable mapped road without distance cap','route_objective':'minimize inferred gap distance, then actual walk distance',
                      'routing_coverage':'OSM extract buffer; service-area endpoints unchanged'})
        reports[name]=result
        (out/f'{name}.json.gz').write_bytes(gzip.compress(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
        print(name,json.dumps(result['summary']),flush=True)
    gate=acceptance(reports);passed=all(gate[key] for key in ('overall_strictly_above_95','all_walking_groups_at_least_95','all_facility_groups_at_least_95'))
    summary={name:{k:v for k,v in report.items() if k!='cases'} for name,report in reports.items()}
    (out/'summary.json').write_text(json.dumps({'acceptance':{**gate,'threshold':0.95,'passed':passed},'audits':summary},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    text=['# Routing 95% audit','',f'**95% acceptance: {"PASS" if passed else "NOT PASSED"}.**','',
          f'Walking-eligible total: **{gate["overall_success"]}/{gate["overall_total"]} ({gate["overall_rate"]:.2%})**。',
          '', '总体必须 >95%；每个 area × category × batch 及每类 facility 专项分别 >=95%。30-case group 至少29/30。',
          '', '## Scope and sampling','',
          '- 原240 primary +240 holdout coordinates 完全保留，按实际 route success 计分。旧 baseline report/raw results 保留在 `DEMO_ROUTING_RANDOM_REPORT_ZH.md` / `demo-routing-audit/`，本次 rerun 另存 `demo-routing-audit-95/`。',
          '- 经用户确认，95% acceptance 使用 walking-eligible primary / holdout，seed20261022 /20261023，每个 area 四类各30，共480条。两批 samples 在首次计算 route success 前冻结。',
          '- Eligibility：两端在 service window 内，来自 mapped walking/roadside coverage；cross-road 仅取有 walking coverage 的道路。两端分别满足20m outdoor / nearest-building access；排除已知 endpoint physical obstacles。',
          '- 不按 connected component 或 route success 筛选，不删除/替换失败，不换 seed 找高分。',
          '- Cross-road 在道路中心线两侧各8m；local streets 两条不同住宅/服务道路，直线50–500m；long distance 直线至少800m；same-side 取同侧道路。',
          '- Facility 专项沿用 seed20261021 的原 samples，指定 facility ID 必须出现在实际返回 route 中。',
          '- 本地 Demo audit 不等于 Live availability、实地通行或 accessibility certification。',
          '', '## Routing policy','',
          '- 固定 endpoint access，优先 recorded roads/footpaths/facilities；只有无法连通时使用 <=20m inferred links。fallback 中先比较 inferred distance，再比较实际 walk distance。',
          '- 不穿 building/fence/water 或无授权 road crossing。Building endpoint 仍关联最近可接入道路，不设任意距离上限。',
          '- 允许沿 OSM extract buffer 内的 recorded roads 绕行，endpoint service window 不扩大。Mapped road bridge 仅在真实共享 OSM approach node 连接同侧 grade transition；2D交叉不能连接上下层。',
          '- Demo facilities 与 Live graph 隔离；推定和虚构通道保留明确 warnings。']
    text.extend(['- 用户明确确认 trunk roadside policy：仅接纳 access=yes 且没有 foot=no/use_sidepath 或 motorroad=yes 的 trunk；motorway、motorway_link、trunk_link 不因此开放。仍禁止无设施横穿。',
                 '- 本次沿用原 OSM extracts，没有采用临时下载的新地图。Demo-only buffer crossings 按统一75m geographic spacing 补充，旧 facility IDs 保留；不是20m open-land links，也不进入 Live。'])
    for names,title in ((WALKING,'Walking-eligible results'),(('random-primary','random-holdout'),'Original 480 rerun'),(('facilities',),'Facility results')):
        text.extend(['',f'## {title}','', '| Batch | Area | Category | Success | Rate |','|---|---|---|---:|---:|'])
        for name in names:
            for row in reports[name]['summary']:
                text.append(f'| {name} | {row["area"]} | {row["category"]} | {row["success"]}/{row["total"]} | {row["rate"]:.2%} |')
    legacy=[r for name in ('random-primary','random-holdout') for r in reports[name]['summary']]
    success=sum(r['success'] for r in legacy);total=sum(r['total'] for r in legacy)
    text.extend(['',f'原480 rerun 总体：**{success}/{total} ({success/total:.2%})**。Motorway/trunk 附近无法满足 access rules 的点仍记失败，没有改算成功。',
                 '', '## Retained failures','', '| Batch | Case | Reason |','|---|---|---|'])
    for name,report in reports.items():
        for row in report['cases']:
            if not row['success']:text.append(f'| {name} | {row["id"]} | {row["reason"]} |')
    text.extend(['','## Reproduce','', '```powershell','python -m backend.tools.audit_demo_navigation',
                 'python -m unittest backend.tests.test_road_priority backend.tests.test_roadside backend.tests.test_open_land_access backend.tests.test_demo_navigation -q','```','',
                 'Raw JSON.GZ 包含全部 coordinates/geometry/maneuvers/失败原因/timings、sample SHA256 和 algorithm SHA256；summary.json 包含 acceptance flags。',
                 '', '此报告不代表已 push、merge、deploy、执行 SQL 或 build APK。',''])
    (ROOT/'docs/api/DEMO_ROUTING_95_REPORT_ZH.md').write_text('\n'.join(text),encoding='utf-8')
    if not passed:raise SystemExit('95% acceptance not passed; keep failed cases and inspect the report.')


if __name__=='__main__':main()
