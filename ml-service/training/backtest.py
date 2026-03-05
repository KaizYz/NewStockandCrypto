from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Dict, List, Optional

import numpy as np
import pandas as pd


@dataclass
class Trade:
    entry_time: pd.Timestamp
    exit_time: Optional[pd.Timestamp]
    entry_price: float
    exit_price: Optional[float]
    direction: str
    size: float
    entry_confidence: float
    stop_loss_price: float
    take_profit_price: float
    take_profit_2_price: float
    pnl: Optional[float] = None
    pnl_pct: Optional[float] = None
    holding_period: Optional[int] = None
    status: str = "OPEN"

    def to_record(self) -> Dict[str, object]:
        payload = asdict(self)
        payload["entry_time"] = self.entry_time.isoformat() if isinstance(self.entry_time, pd.Timestamp) else self.entry_time
        payload["exit_time"] = self.exit_time.isoformat() if isinstance(self.exit_time, pd.Timestamp) else self.exit_time
        return payload


@dataclass
class BacktestResult:
    trades: List[Trade]
    equity_curve: np.ndarray
    drawdown_curve: np.ndarray
    rolling_sharpe: np.ndarray
    metrics: Dict[str, float]

    def trades_frame(self) -> pd.DataFrame:
        if not self.trades:
            return pd.DataFrame()
        return pd.DataFrame([trade.to_record() for trade in self.trades])


class SimpleBacktest:
    def __init__(
        self,
        initial_capital: float = 100000.0,
        commission_rate: float = 0.001,
        slippage_rate: float = 0.0005,
        position_sizing: str = "fixed_fraction",
        risk_per_trade: float = 0.02,
        max_position_size: float = 0.10,
        bars_per_year: int = 252,
    ) -> None:
        self.initial_capital = float(initial_capital)
        self.commission_rate = float(commission_rate)
        self.slippage_rate = float(slippage_rate)
        self.position_sizing = str(position_sizing)
        self.risk_per_trade = float(risk_per_trade)
        self.max_position_size = float(max_position_size)
        self.bars_per_year = max(2, int(bars_per_year))

    @staticmethod
    def _safe_float(value: object, fallback: float) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return float(fallback)
        if not np.isfinite(parsed):
            return float(fallback)
        return float(parsed)

    @staticmethod
    def _signal_to_direction(signal: object) -> str:
        text = str(signal or "FLAT").strip().upper()
        if text in {"LONG", "SHORT", "FLAT"}:
            return text
        if text in {"BUY", "UP", "1"}:
            return "LONG"
        if text in {"SELL", "DOWN", "-1"}:
            return "SHORT"
        return "FLAT"

    def _calculate_position_size(self, capital: float, entry_price: float, confidence: float) -> float:
        if self.position_sizing == "kelly":
            p = max(0.01, min(0.99, confidence))
            q = 1.0 - p
            b = 2.0
            kelly_fraction = (p * b - q) / b if b > 0 else 0.0
            allocation = capital * max(0.0, min(kelly_fraction, 0.25))
        else:
            allocation = capital * self.risk_per_trade
        max_allocation = capital * self.max_position_size
        final_allocation = min(allocation, max_allocation)
        if entry_price <= 0:
            return 0.0
        return final_allocation / entry_price

    def _calculate_position_value(self, trade: Trade, current_price: float) -> float:
        if trade.direction == "LONG":
            return (current_price - trade.entry_price) * trade.size
        return (trade.entry_price - current_price) * trade.size

    def _calculate_pnl(self, trade: Trade) -> float:
        if trade.exit_price is None:
            return 0.0
        if trade.direction == "LONG":
            gross = (trade.exit_price - trade.entry_price) * trade.size
        else:
            gross = (trade.entry_price - trade.exit_price) * trade.size
        commission = (trade.entry_price * trade.size + trade.exit_price * trade.size) * self.commission_rate
        return float(gross - commission)

    def _close_trade(self, trade: Trade, exit_time: pd.Timestamp, exit_price: float, status: str, step: int) -> Trade:
        trade.exit_time = exit_time
        trade.exit_price = float(exit_price)
        trade.status = str(status)
        trade.holding_period = int(step)
        trade.pnl = self._calculate_pnl(trade)
        notional = max(1e-9, trade.entry_price * trade.size)
        trade.pnl_pct = float(trade.pnl / notional)
        return trade

    def _check_exits(
        self,
        open_positions: List[Trade],
        bar: pd.Series,
        ts: pd.Timestamp,
        held_steps: Dict[int, int],
        closed_trades: List[Trade],
    ) -> List[Trade]:
        remaining: List[Trade] = []
        for idx, trade in enumerate(open_positions):
            held_steps[idx] = held_steps.get(idx, 0) + 1
            low = self._safe_float(bar.get("low"), self._safe_float(bar.get("close"), trade.entry_price))
            high = self._safe_float(bar.get("high"), self._safe_float(bar.get("close"), trade.entry_price))

            if trade.direction == "LONG":
                if low <= trade.stop_loss_price:
                    closed_trades.append(self._close_trade(trade, ts, trade.stop_loss_price, "STOPPED", held_steps[idx]))
                    continue
                if high >= trade.take_profit_2_price:
                    closed_trades.append(self._close_trade(trade, ts, trade.take_profit_2_price, "CLOSED", held_steps[idx]))
                    continue
                if high >= trade.take_profit_price:
                    closed_trades.append(self._close_trade(trade, ts, trade.take_profit_price, "CLOSED", held_steps[idx]))
                    continue
            else:
                if high >= trade.stop_loss_price:
                    closed_trades.append(self._close_trade(trade, ts, trade.stop_loss_price, "STOPPED", held_steps[idx]))
                    continue
                if low <= trade.take_profit_2_price:
                    closed_trades.append(self._close_trade(trade, ts, trade.take_profit_2_price, "CLOSED", held_steps[idx]))
                    continue
                if low <= trade.take_profit_price:
                    closed_trades.append(self._close_trade(trade, ts, trade.take_profit_price, "CLOSED", held_steps[idx]))
                    continue
            remaining.append(trade)
        return remaining

    def _calculate_drawdown(self, equity: np.ndarray) -> np.ndarray:
        if len(equity) == 0:
            return np.array([], dtype=np.float64)
        peak = np.maximum.accumulate(equity)
        return (peak - equity) / np.maximum(peak, 1e-9)

    def _max_drawdown_duration(self, drawdown: np.ndarray) -> int:
        if len(drawdown) == 0:
            return 0
        in_drawdown = drawdown > 0
        max_dur = 0
        cur = 0
        for flag in in_drawdown:
            if bool(flag):
                cur += 1
                max_dur = max(max_dur, cur)
            else:
                cur = 0
        return int(max_dur)

    def _calculate_rolling_sharpe(self, equity: np.ndarray, window: int = 63) -> np.ndarray:
        if len(equity) <= 1:
            return np.array([], dtype=np.float64)
        returns = np.diff(equity) / np.maximum(equity[:-1], 1e-9)
        result = np.full(len(returns), np.nan, dtype=np.float64)
        for i in range(window, len(returns)):
            sample = returns[i - window : i]
            annual_mean = float(np.mean(sample) * self.bars_per_year)
            annual_std = float(np.std(sample) * np.sqrt(self.bars_per_year))
            result[i] = annual_mean / annual_std if annual_std > 0 else 0.0
        return result

    def _calculate_metrics(self, equity: np.ndarray, trades: List[Trade]) -> Dict[str, float]:
        if len(equity) <= 1:
            return {
                "total_return": 0.0,
                "annualized_return": 0.0,
                "volatility": 0.0,
                "sharpe_ratio": 0.0,
                "sortino_ratio": 0.0,
                "max_drawdown": 0.0,
                "max_drawdown_duration": 0.0,
                "calmar_ratio": 0.0,
                "total_trades": 0.0,
                "winning_trades": 0.0,
                "losing_trades": 0.0,
                "win_rate": 0.0,
                "avg_win": 0.0,
                "largest_win": 0.0,
                "avg_loss": 0.0,
                "largest_loss": 0.0,
                "profit_factor": 0.0,
                "expected_value": 0.0,
                "avg_holding_period": 0.0,
            }

        returns = np.diff(equity) / np.maximum(equity[:-1], 1e-9)
        total_return = float((equity[-1] / max(equity[0], 1e-9)) - 1.0)
        annualized_return = float((1.0 + total_return) ** (self.bars_per_year / max(1, len(returns))) - 1.0)
        volatility = float(np.std(returns) * np.sqrt(self.bars_per_year))
        sharpe = float(annualized_return / volatility) if volatility > 0 else 0.0

        downside = returns[returns < 0]
        if len(downside) > 0:
            downside_std = float(np.std(downside) * np.sqrt(self.bars_per_year))
            sortino = float(annualized_return / downside_std) if downside_std > 0 else 0.0
        else:
            sortino = float("inf")

        drawdown = self._calculate_drawdown(equity)
        max_drawdown = float(np.max(drawdown)) if len(drawdown) > 0 else 0.0
        calmar = float(annualized_return / max_drawdown) if max_drawdown > 0 else float("inf")

        metrics: Dict[str, float] = {
            "total_return": total_return,
            "annualized_return": annualized_return,
            "volatility": volatility,
            "sharpe_ratio": sharpe,
            "sortino_ratio": sortino,
            "max_drawdown": max_drawdown,
            "max_drawdown_duration": float(self._max_drawdown_duration(drawdown)),
            "calmar_ratio": calmar,
        }

        pnl_values = [t.pnl for t in trades if t.pnl is not None]
        winning = [v for v in pnl_values if v > 0]
        losing = [v for v in pnl_values if v <= 0]
        metrics["total_trades"] = float(len(trades))
        metrics["winning_trades"] = float(len(winning))
        metrics["losing_trades"] = float(len(losing))
        metrics["win_rate"] = float(len(winning) / len(trades)) if trades else 0.0
        metrics["avg_win"] = float(np.mean(winning)) if winning else 0.0
        metrics["largest_win"] = float(np.max(winning)) if winning else 0.0
        metrics["avg_loss"] = float(np.mean(losing)) if losing else 0.0
        metrics["largest_loss"] = float(np.min(losing)) if losing else 0.0
        total_wins = float(np.sum(winning)) if winning else 0.0
        total_losses = abs(float(np.sum(losing))) if losing else 0.0
        metrics["profit_factor"] = float(total_wins / total_losses) if total_losses > 0 else float("inf")
        metrics["expected_value"] = (
            metrics["win_rate"] * metrics["avg_win"] + (1.0 - metrics["win_rate"]) * metrics["avg_loss"]
        ) if trades else 0.0
        holding = [float(t.holding_period) for t in trades if t.holding_period is not None]
        metrics["avg_holding_period"] = float(np.mean(holding)) if holding else 0.0
        return metrics

    def run_backtest(
        self,
        prices: pd.DataFrame,
        signals: pd.DataFrame,
        stop_loss_pct: float = 0.02,
        take_profit_pct: float = 0.04,
        take_profit_2_pct: float = 0.08,
        confidence_threshold: float = 0.55,
    ) -> BacktestResult:
        required = {"open", "high", "low", "close"}
        missing = required - set(prices.columns)
        if missing:
            raise ValueError(f"Price frame is missing required columns: {sorted(missing)}")
        if len(prices) == 0:
            return BacktestResult([], np.array([], dtype=np.float64), np.array([], dtype=np.float64), np.array([], dtype=np.float64), {})

        prices_sorted = prices.sort_index().copy()
        signals_aligned = signals.reindex(prices_sorted.index).copy()
        if "signal" not in signals_aligned.columns:
            signals_aligned["signal"] = "FLAT"
        if "confidence" not in signals_aligned.columns:
            signals_aligned["confidence"] = 0.0

        capital = float(self.initial_capital)
        equity: List[float] = [capital]
        closed_trades: List[Trade] = []
        open_positions: List[Trade] = []
        held_steps: Dict[int, int] = {}

        for i in range(1, len(prices_sorted)):
            ts = pd.Timestamp(prices_sorted.index[i])
            bar = prices_sorted.iloc[i]
            current_price = self._safe_float(bar.get("close"), 0.0)
            if current_price <= 0:
                equity.append(capital)
                continue

            open_positions = self._check_exits(open_positions, bar, ts, held_steps, closed_trades)
            position_value = sum(self._calculate_position_value(pos, current_price) for pos in open_positions)
            equity.append(capital + position_value)

            signal_row = signals_aligned.iloc[i]
            signal = self._signal_to_direction(signal_row.get("signal"))
            confidence = self._safe_float(signal_row.get("confidence"), 0.0)
            if confidence < confidence_threshold or signal == "FLAT":
                continue

            entry_price = current_price * (1 + self.slippage_rate if signal == "LONG" else 1 - self.slippage_rate)
            size = self._calculate_position_size(capital, entry_price, confidence)
            if size <= 0:
                continue

            stop_loss_price = self._safe_float(
                signal_row.get("stop_loss"),
                entry_price * (1 - stop_loss_pct if signal == "LONG" else 1 + stop_loss_pct),
            )
            take_profit_price = self._safe_float(
                signal_row.get("take_profit"),
                entry_price * (1 + take_profit_pct if signal == "LONG" else 1 - take_profit_pct),
            )
            take_profit_2_price = self._safe_float(
                signal_row.get("take_profit_2"),
                entry_price * (1 + take_profit_2_pct if signal == "LONG" else 1 - take_profit_2_pct),
            )

            trade = Trade(
                entry_time=ts,
                exit_time=None,
                entry_price=float(entry_price),
                exit_price=None,
                direction=signal,
                size=float(size),
                entry_confidence=float(confidence),
                stop_loss_price=float(stop_loss_price),
                take_profit_price=float(take_profit_price),
                take_profit_2_price=float(take_profit_2_price),
                status="OPEN",
            )
            open_positions.append(trade)

        if open_positions:
            last_ts = pd.Timestamp(prices_sorted.index[-1])
            last_close = self._safe_float(prices_sorted["close"].iloc[-1], 0.0)
            for trade in open_positions:
                closed_trades.append(self._close_trade(trade, last_ts, last_close, "CLOSED", len(prices_sorted)))

        equity_arr = np.asarray(equity, dtype=np.float64)
        drawdown = self._calculate_drawdown(equity_arr)
        rolling_sharpe = self._calculate_rolling_sharpe(equity_arr)
        metrics = self._calculate_metrics(equity_arr, closed_trades)
        return BacktestResult(
            trades=closed_trades,
            equity_curve=equity_arr,
            drawdown_curve=drawdown,
            rolling_sharpe=rolling_sharpe,
            metrics=metrics,
        )
