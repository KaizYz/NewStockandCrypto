from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from training.backtest import SimpleBacktest


class BacktestEngineTest(unittest.TestCase):
    def test_backtest_outputs_metrics_and_curves(self) -> None:
        idx = pd.date_range("2024-01-01", periods=80, freq="h", tz="UTC")
        close = np.linspace(100, 112, len(idx))
        prices = pd.DataFrame(
            {
                "open": close - 0.2,
                "high": close + 0.4,
                "low": close - 0.5,
                "close": close,
            },
            index=idx,
        )
        signals = pd.DataFrame(
            {
                "signal": ["LONG" if i % 7 in (1, 2, 3) else "FLAT" for i in range(len(idx))],
                "confidence": [0.62 if i % 7 in (1, 2, 3) else 0.45 for i in range(len(idx))],
            },
            index=idx,
        )

        engine = SimpleBacktest(
            initial_capital=100000.0,
            commission_rate=0.0005,
            slippage_rate=0.0002,
            risk_per_trade=0.02,
            max_position_size=0.10,
            bars_per_year=24 * 365,
        )
        result = engine.run_backtest(
            prices=prices,
            signals=signals,
            stop_loss_pct=0.02,
            take_profit_pct=0.04,
            take_profit_2_pct=0.08,
            confidence_threshold=0.55,
        )

        self.assertGreater(len(result.equity_curve), 0)
        self.assertEqual(len(result.equity_curve), len(idx))
        self.assertIn("total_return", result.metrics)
        self.assertIn("sharpe_ratio", result.metrics)
        self.assertIn("max_drawdown", result.metrics)


if __name__ == "__main__":
    unittest.main()
