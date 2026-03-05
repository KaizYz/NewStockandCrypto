from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, Generator, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    log_loss,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
)

try:
    from scipy import stats
except Exception:  # pragma: no cover - optional in some environments
    stats = None


def _safe_confusion(y_true: np.ndarray, y_pred: np.ndarray) -> tuple[int, int, int, int]:
    labels = np.array([0, 1], dtype=np.int64)
    cm = confusion_matrix(y_true, y_pred, labels=labels)
    if cm.shape != (2, 2):
        return 0, 0, 0, 0
    tn, fp, fn, tp = cm.ravel()
    return int(tn), int(fp), int(fn), int(tp)


def _safe_div(num: float, den: float) -> float:
    return float(num / den) if den != 0 else 0.0


def expected_calibration_error(y_true: np.ndarray, y_pred_proba: np.ndarray, bins: int = 10) -> float:
    if len(y_true) == 0:
        return 0.0
    edges = np.linspace(0.0, 1.0, bins + 1)
    ece = 0.0
    total = len(y_true)
    for i in range(bins):
        left = edges[i]
        right = edges[i + 1]
        if i == bins - 1:
            mask = (y_pred_proba >= left) & (y_pred_proba <= right)
        else:
            mask = (y_pred_proba >= left) & (y_pred_proba < right)
        if not np.any(mask):
            continue
        bucket_conf = float(np.mean(y_pred_proba[mask]))
        bucket_acc = float(np.mean(y_true[mask]))
        ece += abs(bucket_acc - bucket_conf) * (int(mask.sum()) / total)
    return float(ece)


@dataclass
class DirectionEvaluationResult:
    metrics: Dict[str, float]
    calibration: Dict[str, object]
    optimal_threshold: Dict[str, float]


class DirectionEvaluator:
    """Comprehensive evaluation for binary direction prediction."""

    def __init__(self, y_true: np.ndarray, y_pred_proba: np.ndarray, threshold: float = 0.5) -> None:
        self.y_true = np.asarray(y_true, dtype=np.int64)
        clipped = np.asarray(y_pred_proba, dtype=np.float64)
        self.y_pred_proba = np.clip(clipped, 1e-8, 1.0 - 1e-8)
        self.threshold = float(threshold)
        self.y_pred = (self.y_pred_proba >= self.threshold).astype(np.int64)

    @staticmethod
    def _compute_mcc(tp: int, tn: int, fp: int, fn: int) -> float:
        numerator = tp * tn - fp * fn
        denominator = np.sqrt((tp + fp) * (tp + fn) * (tn + fp) * (tn + fn))
        return float(numerator / denominator) if denominator > 0 else 0.0

    @staticmethod
    def _compute_kappa(tp: int, tn: int, fp: int, fn: int) -> float:
        total = tp + tn + fp + fn
        if total == 0:
            return 0.0
        observed = (tp + tn) / total
        expected = ((tp + fp) * (tp + fn) + (tn + fp) * (tn + fn)) / (total**2)
        return float((observed - expected) / (1.0 - expected)) if expected < 1.0 else 0.0

    def compute_all_metrics(self) -> Dict[str, float]:
        metrics: Dict[str, float] = {}
        if len(self.y_true) == 0:
            return {
                "accuracy": 0.0,
                "precision": 0.0,
                "recall": 0.0,
                "f1": 0.0,
                "auc_roc": 0.0,
                "log_loss": 0.0,
                "brier_score": 0.0,
                "true_positives": 0.0,
                "true_negatives": 0.0,
                "false_positives": 0.0,
                "false_negatives": 0.0,
                "specificity": 0.0,
                "npv": 0.0,
                "fpr": 0.0,
                "fnr": 0.0,
                "mcc": 0.0,
                "kappa": 0.0,
            }

        metrics["accuracy"] = float(accuracy_score(self.y_true, self.y_pred))
        metrics["precision"] = float(precision_score(self.y_true, self.y_pred, zero_division=0))
        metrics["recall"] = float(recall_score(self.y_true, self.y_pred, zero_division=0))
        metrics["f1"] = float(f1_score(self.y_true, self.y_pred, zero_division=0))

        # AUC requires both classes in y_true.
        unique = np.unique(self.y_true)
        if len(unique) > 1:
            metrics["auc_roc"] = float(roc_auc_score(self.y_true, self.y_pred_proba))
            metrics["log_loss"] = float(log_loss(self.y_true, self.y_pred_proba, labels=[0, 1]))
        else:
            metrics["auc_roc"] = 0.5
            metrics["log_loss"] = float(log_loss(self.y_true, self.y_pred_proba, labels=[0, 1]))
        metrics["brier_score"] = float(brier_score_loss(self.y_true, self.y_pred_proba))

        tn, fp, fn, tp = _safe_confusion(self.y_true, self.y_pred)
        metrics["true_positives"] = float(tp)
        metrics["true_negatives"] = float(tn)
        metrics["false_positives"] = float(fp)
        metrics["false_negatives"] = float(fn)
        metrics["specificity"] = _safe_div(tn, tn + fp)
        metrics["npv"] = _safe_div(tn, tn + fn)
        metrics["fpr"] = _safe_div(fp, fp + tn)
        metrics["fnr"] = _safe_div(fn, fn + tp)
        metrics["mcc"] = self._compute_mcc(tp, tn, fp, fn)
        metrics["kappa"] = self._compute_kappa(tp, tn, fp, fn)
        return metrics

    def calibration_analysis(self, n_bins: int = 10) -> Dict[str, object]:
        bins = np.linspace(0.0, 1.0, n_bins + 1)
        indices = np.digitize(self.y_pred_proba, bins) - 1
        indices = np.clip(indices, 0, n_bins - 1)

        rows: List[Dict[str, float]] = []
        for idx in range(n_bins):
            mask = indices == idx
            if int(mask.sum()) == 0:
                continue
            mean_predicted = float(np.mean(self.y_pred_proba[mask]))
            mean_actual = float(np.mean(self.y_true[mask]))
            count = int(mask.sum())
            cal_error = abs(mean_predicted - mean_actual)
            rows.append(
                {
                    "bin": float(idx),
                    "bin_lower": float(bins[idx]),
                    "bin_upper": float(bins[idx + 1]),
                    "mean_predicted": mean_predicted,
                    "mean_actual": mean_actual,
                    "count": float(count),
                    "calibration_error": float(cal_error),
                }
            )

        if len(self.y_true) == 0:
            ece = 0.0
        else:
            ece = float(sum(float(r["calibration_error"]) * float(r["count"]) for r in rows) / len(self.y_true))
        mce = float(max((float(r["calibration_error"]) for r in rows), default=0.0))
        return {
            "bins": rows,
            "expected_calibration_error": ece,
            "maximum_calibration_error": mce,
        }

    def threshold_optimization(self, metric: str = "f1") -> Dict[str, float]:
        thresholds = np.arange(0.05, 0.95, 0.01, dtype=np.float64)
        records: List[Dict[str, float]] = []
        for thresh in thresholds:
            y_pred = (self.y_pred_proba >= thresh).astype(np.int64)
            tn, fp, fn, tp = _safe_confusion(self.y_true, y_pred)
            accuracy = _safe_div(tp + tn, tp + tn + fp + fn)
            precision = _safe_div(tp, tp + fp)
            recall = _safe_div(tp, tp + fn)
            f1 = _safe_div(2.0 * precision * recall, precision + recall)
            specificity = _safe_div(tn, tn + fp)
            youden_j = recall + specificity - 1.0
            records.append(
                {
                    "threshold": float(thresh),
                    "accuracy": float(accuracy),
                    "precision": float(precision),
                    "recall": float(recall),
                    "f1": float(f1),
                    "youden_j": float(youden_j),
                }
            )

        result_df = pd.DataFrame(records)
        if result_df.empty:
            return {
                "threshold": self.threshold,
                "accuracy": 0.0,
                "precision": 0.0,
                "recall": 0.0,
                "f1": 0.0,
                "youden_j": 0.0,
            }

        if metric == "accuracy":
            idx = int(result_df["accuracy"].idxmax())
        elif metric == "youden":
            idx = int(result_df["youden_j"].idxmax())
        else:
            idx = int(result_df["f1"].idxmax())
        row = result_df.iloc[idx].to_dict()
        return {k: float(v) for k, v in row.items()}

    def evaluate(self, threshold_metric: str = "f1") -> DirectionEvaluationResult:
        return DirectionEvaluationResult(
            metrics=self.compute_all_metrics(),
            calibration=self.calibration_analysis(),
            optimal_threshold=self.threshold_optimization(metric=threshold_metric),
        )


class MagnitudeEvaluator:
    """Evaluation for magnitude prediction."""

    def __init__(self, y_true: np.ndarray, y_pred: np.ndarray) -> None:
        self.y_true = np.asarray(y_true, dtype=np.float64)
        self.y_pred = np.asarray(y_pred, dtype=np.float64)

    def compute_all_metrics(self) -> Dict[str, float]:
        if len(self.y_true) == 0:
            return {
                "mae": 0.0,
                "mse": 0.0,
                "rmse": 0.0,
                "r2": 0.0,
                "mape": 0.0,
                "smape": 0.0,
                "direction_accuracy": 0.0,
                "pearson_r": 0.0,
                "spearman_r": 0.0,
                "bias": 0.0,
                "relative_bias": 0.0,
            }

        metrics: Dict[str, float] = {}
        metrics["mae"] = float(mean_absolute_error(self.y_true, self.y_pred))
        metrics["mse"] = float(mean_squared_error(self.y_true, self.y_pred))
        metrics["rmse"] = float(np.sqrt(metrics["mse"]))
        metrics["r2"] = float(r2_score(self.y_true, self.y_pred))

        mask = self.y_true != 0
        if bool(mask.any()):
            metrics["mape"] = float(np.mean(np.abs((self.y_true[mask] - self.y_pred[mask]) / self.y_true[mask])))
        else:
            metrics["mape"] = float("inf")
        metrics["smape"] = float(np.mean(2.0 * np.abs(self.y_pred - self.y_true) / (np.abs(self.y_true) + np.abs(self.y_pred) + 1e-9)))

        direction_match = ((self.y_true > 0) & (self.y_pred > 0)) | ((self.y_true < 0) & (self.y_pred < 0))
        metrics["direction_accuracy"] = float(np.mean(direction_match))

        if stats is not None and len(self.y_true) > 1:
            try:
                metrics["pearson_r"] = float(stats.pearsonr(self.y_true, self.y_pred)[0])
            except Exception:
                metrics["pearson_r"] = 0.0
            try:
                metrics["spearman_r"] = float(stats.spearmanr(self.y_true, self.y_pred)[0])
            except Exception:
                metrics["spearman_r"] = 0.0
        else:
            metrics["pearson_r"] = 0.0
            metrics["spearman_r"] = 0.0

        metrics["bias"] = float(np.mean(self.y_pred - self.y_true))
        metrics["relative_bias"] = float(metrics["bias"] / (np.mean(np.abs(self.y_true)) + 1e-9))
        return metrics

    def quantile_coverage_analysis(self, q10: np.ndarray, q50: np.ndarray, q90: np.ndarray) -> Dict[str, float]:
        y = self.y_true
        q10_arr = np.asarray(q10, dtype=np.float64)
        q50_arr = np.asarray(q50, dtype=np.float64)
        q90_arr = np.asarray(q90, dtype=np.float64)
        if len(y) == 0:
            return {
                "q10_coverage": 0.0,
                "q50_coverage": 0.0,
                "q90_coverage": 0.0,
                "pi80_coverage": 0.0,
                "mean_interval_width": 0.0,
                "sharpness": 0.0,
            }
        interval = q90_arr - q10_arr
        return {
            "q10_coverage": float(np.mean(y < q10_arr)),
            "q50_coverage": float(np.mean(y < q50_arr)),
            "q90_coverage": float(np.mean(y < q90_arr)),
            "pi80_coverage": float(np.mean((y >= q10_arr) & (y <= q90_arr))),
            "mean_interval_width": float(np.mean(interval)),
            "sharpness": float(np.std(interval)),
        }


class WalkForwardValidator:
    def __init__(
        self,
        n_splits: int = 5,
        train_size: int = 252,
        test_size: int = 63,
        expanding: bool = False,
    ) -> None:
        self.n_splits = int(n_splits)
        self.train_size = int(train_size)
        self.test_size = int(test_size)
        self.expanding = bool(expanding)

    def split(self, n_samples: int) -> Generator[Tuple[np.ndarray, np.ndarray], None, None]:
        initial_train_end = self.train_size
        for i in range(self.n_splits):
            test_start = initial_train_end + i * self.test_size
            test_end = test_start + self.test_size
            if test_end > n_samples:
                break
            if self.expanding:
                train_start = 0
                train_end = test_start
            else:
                train_start = test_start - self.train_size
                train_end = test_start
            if train_start < 0:
                continue
            train_idx = np.arange(train_start, train_end, dtype=np.int64)
            test_idx = np.arange(test_start, test_end, dtype=np.int64)
            if len(train_idx) == 0 or len(test_idx) == 0:
                continue
            yield train_idx, test_idx


class PurgedWalkForwardValidator(WalkForwardValidator):
    def __init__(
        self,
        n_splits: int = 5,
        train_size: int = 252,
        test_size: int = 63,
        purge_size: int = 5,
        embargo_size: int = 5,
        expanding: bool = False,
    ) -> None:
        super().__init__(n_splits=n_splits, train_size=train_size, test_size=test_size, expanding=expanding)
        self.purge_size = int(purge_size)
        self.embargo_size = int(embargo_size)

    def split(self, n_samples: int) -> Generator[Tuple[np.ndarray, np.ndarray], None, None]:
        initial_train_end = self.train_size
        for i in range(self.n_splits):
            test_start = initial_train_end + i * (self.test_size + self.embargo_size) + self.purge_size
            test_end = test_start + self.test_size
            if test_end > n_samples:
                break
            if self.expanding:
                train_start = 0
                train_end = test_start - self.purge_size
            else:
                train_start = test_start - self.purge_size - self.train_size
                train_end = test_start - self.purge_size
            if train_start < 0 or train_end <= train_start:
                continue
            train_idx = np.arange(train_start, train_end, dtype=np.int64)
            test_idx = np.arange(test_start, test_end, dtype=np.int64)
            if len(train_idx) == 0 or len(test_idx) == 0:
                continue
            yield train_idx, test_idx


def benchmark_grade(metric_name: str, value: float) -> str:
    ranges = {
        "direction_accuracy": (0.52, 0.55, 0.58, "higher"),
        "auc_roc": (0.52, 0.55, 0.60, "higher"),
        "brier_score": (0.25, 0.20, 0.15, "lower"),
        "sharpe_ratio": (0.5, 1.0, 2.0, "higher"),
        "max_drawdown": (0.30, 0.20, 0.10, "lower"),
        "win_rate": (0.45, 0.50, 0.55, "higher"),
        "profit_factor": (1.0, 1.3, 1.5, "higher"),
    }
    if metric_name not in ranges:
        return "unknown"
    poor, acceptable, good, direction = ranges[metric_name]
    if direction == "higher":
        if value > good:
            return "excellent"
        if value >= acceptable:
            return "good"
        if value >= poor:
            return "acceptable"
        return "poor"
    if value < good:
        return "excellent"
    if value <= acceptable:
        return "good"
    if value <= poor:
        return "acceptable"
    return "poor"


def summarize_fold_records(records: Iterable[Dict[str, object]], metric_keys: Iterable[str]) -> Dict[str, float]:
    rows = list(records)
    summary: Dict[str, float] = {}
    for key in metric_keys:
        values: List[float] = []
        for row in rows:
            raw = row.get(key)
            if isinstance(raw, (int, float)) and np.isfinite(float(raw)):
                values.append(float(raw))
        summary[key] = float(np.mean(values)) if values else 0.0
    return summary


def fold_records_to_dataframe(records: List[Dict[str, object]]) -> pd.DataFrame:
    if not records:
        return pd.DataFrame()
    return pd.DataFrame(records)
