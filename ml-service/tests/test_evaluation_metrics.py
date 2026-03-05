from __future__ import annotations

import unittest

import numpy as np

from training.evaluation import DirectionEvaluator, MagnitudeEvaluator


class EvaluationMetricsTest(unittest.TestCase):
    def test_direction_metrics_shapes(self) -> None:
        y_true = np.array([1, 1, 0, 0, 1, 0], dtype=np.int64)
        probs = np.array([0.8, 0.7, 0.2, 0.4, 0.65, 0.35], dtype=np.float64)
        evaluator = DirectionEvaluator(y_true, probs)
        result = evaluator.evaluate(threshold_metric="f1")

        self.assertIn("accuracy", result.metrics)
        self.assertIn("auc_roc", result.metrics)
        self.assertIn("brier_score", result.metrics)
        self.assertGreaterEqual(result.metrics["accuracy"], 0.0)
        self.assertLessEqual(result.metrics["accuracy"], 1.0)
        self.assertIn("expected_calibration_error", result.calibration)
        self.assertIn("threshold", result.optimal_threshold)

    def test_magnitude_metrics_basic(self) -> None:
        y_true = np.array([0.01, -0.01, 0.015, -0.005], dtype=np.float64)
        y_pred = np.array([0.008, -0.012, 0.012, -0.004], dtype=np.float64)
        q10 = y_pred - 0.01
        q90 = y_pred + 0.01
        evaluator = MagnitudeEvaluator(y_true, y_pred)
        metrics = evaluator.compute_all_metrics()
        coverage = evaluator.quantile_coverage_analysis(q10, y_pred, q90)

        self.assertIn("rmse", metrics)
        self.assertIn("direction_accuracy", metrics)
        self.assertIn("pi80_coverage", coverage)
        self.assertGreaterEqual(coverage["pi80_coverage"], 0.0)
        self.assertLessEqual(coverage["pi80_coverage"], 1.0)


if __name__ == "__main__":
    unittest.main()
