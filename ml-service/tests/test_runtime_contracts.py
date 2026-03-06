from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.services.health_logic import quality_status_from_metrics, runtime_status
from training.runtime_manifest import build_runtime_manifest, resolve_horizon


class RuntimeContractsTest(unittest.TestCase):
    def test_quality_and_runtime_status_are_decoupled(self) -> None:
        quality = quality_status_from_metrics(0.66, 0.82, 0.03)
        runtime = runtime_status(
            last_update_at=None,
            refresh_interval_sec=10,
            session_state='OPEN',
            last_error='feed down',
        )

        self.assertEqual(quality[0], 'HEALTHY')
        self.assertEqual(runtime[0], 'UNAVAILABLE')

    def test_auto_switch_order_prefers_nearest_allowed_horizon(self) -> None:
        resolved, switched_from = resolve_horizon('1D', ['4H'])
        self.assertEqual(resolved, '4H')
        self.assertEqual(switched_from, '1D')

    def test_runtime_manifest_keeps_deep_checkpoint_runtime_without_ensemble_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            artifact_dir = Path(tmpdir)
            model_dir = artifact_dir / 'models' / '1H'
            model_dir.mkdir(parents=True, exist_ok=True)
            (model_dir / 'lstm.pt').write_bytes(b'lstm')
            (model_dir / 'ensemble.joblib').write_bytes(b'ensemble')

            outputs = {
                'lstm': {
                    'BTCUSDT': {
                        '1H': {
                            'referencePrice': 0.0,
                            'prediction': {'pUp': 0.5},
                            'explanation': {
                                'summary': 'LSTM fallback forecast for BTCUSDT at 1H. Missing asset coverage in this horizon run.',
                                'topFeatures': [{'name': 'missing_coverage', 'value': 0.0}],
                            },
                        }
                    }
                },
                'ensemble': {
                    'BTCUSDT': {
                        '1H': {
                            'referencePrice': 0.0,
                            'prediction': {'pUp': 0.5},
                            'explanation': {
                                'summary': 'ENSEMBLE fallback forecast for BTCUSDT at 1H. Missing asset coverage in this horizon run.',
                                'topFeatures': [{'name': 'missing_coverage', 'value': 0.0}],
                            },
                        }
                    }
                },
            }
            meta = {
                'model_version': 'unit-test',
                'training_timestamp': '2026-03-06T00:00:00+00:00',
                'assets': ['BTCUSDT'],
                'horizons': ['1H'],
                'models': ['lstm', 'ensemble'],
            }

            manifest = build_runtime_manifest(
                artifact_dir=artifact_dir,
                outputs=outputs,
                meta=meta,
                sequence_length=32,
                asset_id_map={},
            )
            models = manifest['assets']['BTCUSDT']['horizons']['1H']['models']

            self.assertTrue(models['lstm']['valid'])
            self.assertEqual(models['lstm']['reason'], 'checkpoint_only_runtime')
            self.assertFalse(models['ensemble']['valid'])
            self.assertEqual(models['ensemble']['reason'], 'fallback_output')


if __name__ == '__main__':
    unittest.main()
