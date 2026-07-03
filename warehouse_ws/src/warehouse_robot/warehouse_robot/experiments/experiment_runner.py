"""
Automated Experiment Runner — drives live backend via REST API.
"""
import csv
import json
import os
import statistics
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx


@dataclass
class ScenarioConfig:
    name:              str
    num_robots:        int
    duration_s:        float
    crash_mode:        str   = 'none'
    crash_probability: float = 0.0
    network_condition: str   = 'GOOD'
    description:       str   = ''


@dataclass
class ExperimentResult:
    scenario_name:          str
    num_robots:             int
    duration_s:             float
    network_condition:      str
    crash_mode:             str
    tasks_generated:        int   = 0
    tasks_completed:        int   = 0
    tasks_failed:           int   = 0
    deadline_rate_pct:      float = 0.0
    throughput_per_min:     float = 0.0
    total_crashes:          int   = 0
    total_recoveries:       int   = 0
    mttr_s:                 float = 0.0
    mtbf_s:                 float = 0.0
    fleet_availability_pct: float = 100.0
    per_robot_json:         str   = ''
    start_ts:               float = field(default_factory=time.time)
    end_ts:                 float = 0.0

    @property
    def elapsed_s(self):
        return (self.end_ts or time.time()) - self.start_ts


DEFAULT_SCENARIOS: List[ScenarioConfig] = [
    ScenarioConfig('baseline_6r', 6, 60.0, description='Baseline: 6 robots, good network'),
    ScenarioConfig('scale_1r',    1, 45.0, description='Single robot throughput'),
    ScenarioConfig('scale_3r',    3, 45.0, description='3 robot scaling'),
    ScenarioConfig('scale_6r',    6, 60.0, description='6 robot scaling'),
    ScenarioConfig('scale_10r',  10, 60.0, description='Max fleet: 10 robots'),
    ScenarioConfig('crash_random_6r', 6, 90.0, crash_mode='random',
                   crash_probability=0.05, description='Random crashes — MTTR/MTBF'),
    ScenarioConfig('network_degraded', 6, 60.0, network_condition='DEGRADED',
                   description='Degraded WiFi'),
    ScenarioConfig('network_poor',     6, 60.0, network_condition='POOR',
                   description='Poor connectivity'),
    ScenarioConfig('combined_stress',  8, 120.0, crash_mode='random',
                   crash_probability=0.03, network_condition='DEGRADED',
                   description='8 robots + crashes + degraded network'),
]


class ExperimentRunner:

    def __init__(self, api_base: str = 'http://localhost:8080',
                 poll_interval_s: float = 2.0, timeout_s: float = 10.0):
        self.api_base      = api_base.rstrip('/')
        self.poll_interval = poll_interval_s
        self.timeout       = timeout_s
        self.results: List[ExperimentResult] = []

    def run_all_scenarios(self, output_dir: str = '~/warehouse_ws/experiment_results',
                          scenarios: Optional[List[ScenarioConfig]] = None
                          ) -> List[ExperimentResult]:
        output_path = Path(output_dir).expanduser()
        output_path.mkdir(parents=True, exist_ok=True)
        scenarios = scenarios or DEFAULT_SCENARIOS
        print(f'\nExperiment Runner | API: {self.api_base} | {len(scenarios)} scenarios\n')

        if not self._health_check():
            print('ERROR: API gateway not reachable. Start backend first.')
            return []

        for i, sc in enumerate(scenarios, 1):
            print(f'[{i}/{len(scenarios)}] {sc.name}: {sc.description}')
            result = self._run_scenario(sc)
            self.results.append(result)
            self._print_result(result)

        self._write_csv(output_path / 'experiment_results.csv')
        self._write_json(output_path / 'experiment_results.json')
        self._write_robot_csv(output_path / 'robot_metrics.csv')
        print(f'\nResults saved to {output_path}')
        return self.results

    def run_scenario(self, scenario: ScenarioConfig) -> ExperimentResult:
        return self._run_scenario(scenario)

    def _run_scenario(self, sc: ScenarioConfig) -> ExperimentResult:
        result = ExperimentResult(
            scenario_name=sc.name, num_robots=sc.num_robots,
            duration_s=sc.duration_s, network_condition=sc.network_condition,
            crash_mode=sc.crash_mode, start_ts=time.time())
        try:
            if sc.network_condition != 'GOOD':
                self._set_network(sc.network_condition)
            deadline = time.time() + sc.duration_s
            while time.time() < deadline:
                time.sleep(self.poll_interval)
            metrics = self._get('/api/metrics')
            faults  = self._get('/api/faults')
            if sc.network_condition != 'GOOD':
                self._set_network('GOOD')
            result.end_ts = time.time()
            self._populate(result, metrics, faults)
        except Exception as e:
            print(f'  Scenario error: {e}')
            result.end_ts = time.time()
        return result

    def _populate(self, result, metrics, faults):
        sys_m   = metrics.get('system', {})
        robot_m = metrics.get('robots', {})
        result.tasks_generated     = sys_m.get('total_tasks_generated', 0)
        result.tasks_completed     = sys_m.get('total_tasks_completed', 0)
        result.tasks_failed        = sys_m.get('total_tasks_failed', 0)
        result.throughput_per_min  = sys_m.get('throughput_per_minute', 0.0)
        result.deadline_rate_pct   = sys_m.get('overall_deadline_rate', 0.0)
        result.total_crashes       = sys_m.get('total_crashes', 0)
        result.total_recoveries    = sys_m.get('total_recoveries', 0)
        mttr_vals = [r['mttr_s'] for r in robot_m.values() if r.get('mttr_s', 0) > 0]
        mtbf_vals = [r['mtbf_s'] for r in robot_m.values()
                     if 0 < r.get('mtbf_s', 0) < 99999]
        result.mttr_s = round(statistics.mean(mttr_vals), 2) if mttr_vals else 0.0
        result.mtbf_s = round(statistics.mean(mtbf_vals), 2) if mtbf_vals else 0.0
        avail_vals = [r.get('availability_pct', 100.0) for r in robot_m.values()]
        result.fleet_availability_pct = round(
            statistics.mean(avail_vals) if avail_vals else 100.0, 2)
        result.per_robot_json = json.dumps({
            rid: {'tasks_completed': r.get('tasks_completed', 0),
                  'crash_count': r.get('crash_count', 0),
                  'mttr_s': r.get('mttr_s', 0),
                  'avg_battery_pct': r.get('avg_battery_pct', 0),
                  'availability_pct': r.get('availability_pct', 100.0)}
            for rid, r in robot_m.items()})

    def _get(self, path: str) -> Dict[str, Any]:
        try:
            r = httpx.get(f'{self.api_base}{path}', timeout=self.timeout)
            r.raise_for_status()
            return r.json()
        except Exception:
            return {}

    def _post(self, path: str, **params) -> Dict[str, Any]:
        try:
            r = httpx.post(f'{self.api_base}{path}', params=params, timeout=self.timeout)
            return r.json()
        except Exception:
            return {}

    def _health_check(self) -> bool:
        try:
            return httpx.get(f'{self.api_base}/health', timeout=5.0).status_code == 200
        except Exception:
            return False

    def _set_network(self, condition: str):
        self._post('/api/network/condition', condition=condition)
        print(f'  Network -> {condition}')

    def _write_csv(self, path: Path):
        if not self.results:
            return
        fields = [f for f in asdict(self.results[0]) if f != 'per_robot_json']
        with open(path, 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            for r in self.results:
                row = {k: v for k, v in asdict(r).items() if k != 'per_robot_json'}
                w.writerow(row)

    def _write_json(self, path: Path):
        with open(path, 'w') as f:
            json.dump([asdict(r) for r in self.results], f, indent=2, default=str)

    def _write_robot_csv(self, path: Path):
        rows = []
        for result in self.results:
            try:
                for rid, d in json.loads(result.per_robot_json or '{}').items():
                    rows.append({'scenario': result.scenario_name, 'robot_id': rid, **d})
            except Exception:
                pass
        if not rows:
            return
        with open(path, 'w', newline='') as f:
            w = csv.DictWriter(f, fieldnames=rows[0].keys())
            w.writeheader()
            w.writerows(rows)

    def _print_result(self, r: ExperimentResult):
        print(f'  Done {r.elapsed_s:.1f}s | tasks={r.tasks_completed} '
              f'| deadline_rate={r.deadline_rate_pct:.1f}% '
              f'| MTTR={r.mttr_s:.1f}s | avail={r.fleet_availability_pct:.1f}%')


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--api',      default='http://localhost:8080')
    p.add_argument('--output',   default='~/warehouse_ws/experiment_results')
    p.add_argument('--scenario', default=None)
    p.add_argument('--duration', type=float, default=None)
    args = p.parse_args()
    runner = ExperimentRunner(api_base=args.api)
    if args.scenario:
        matches = [s for s in DEFAULT_SCENARIOS if s.name == args.scenario]
        if not matches:
            print(f'Unknown: {args.scenario}. Available:')
            for s in DEFAULT_SCENARIOS:
                print(f'  {s.name}')
            return
        sc = matches[0]
        if args.duration:
            sc.duration_s = args.duration
        runner.run_all_scenarios(output_dir=args.output, scenarios=[sc])
    else:
        runner.run_all_scenarios(output_dir=args.output)


if __name__ == '__main__':
    main()