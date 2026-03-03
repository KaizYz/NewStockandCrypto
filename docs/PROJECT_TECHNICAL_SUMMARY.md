# StockandCrypto 项目技术全景分析报告

**生成时间**: 2026-03-02  
**分析深度**: 完整代码库 + 架构 + 数据流 + 模型训练  
**项目状态**: Paper Trading IN REVIEW（持续评估中）

---

## 📊 项目概览

### 项目定位
**StockandCrypto** 是一个端到端的多市场预测与交易决策支持系统，覆盖三大市场：
- **加密货币市场** (Crypto): BTC/ETH/SOL + Top 100（剔除稳定币）
- **中国A股市场**: 上证指数成分股 + 沪深300成分股
- **美股市场**: 道琼斯30 + 纳斯达克100 + 标普500

### 核心功能
1. **多时间框架预测**: 小时级（1h/2h/4h）和日线级（1d/3d/7d）
2. **三重预测任务**: 方向概率 + 启动窗口 + 幅度区间（q10/q50/q90）
3. **实时市场快照**: 当前价格 + 预测价格 + 预测幅度 + 预期日期
4. **策略信号生成**: Long/Short/Flat + 仓位大小 + 期望收益
5. **回测与监控**: Walk-Forward回测 + 漂移检测 + 模型退休机制

---

## 🏗️ 技术架构全景

### 整体架构（分层设计）

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│  ┌──────────────────┐        ┌──────────────────┐           │
│  │ Streamlit Dashboard│        │   Web Frontend   │           │
│  │  (dashboard/app.py)│        │  (HTML/JS/CSS)   │           │
│  └──────────────────┘        └──────────────────┘           │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Policy Engine & Decision Support                     │   │
│  │  (src/models/policy.py, generate_policy_signals.py)   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      ML Pipeline Layer                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Training │ │   HPO    │ │Calibrate │ │ Predict  │       │
│  │  Engine  │ │  Engine  │ │  Engine  │ │  Engine  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Features │ │  Labels  │ │  Split   │ │Backtest  │       │
│  │  Engine  │ │  Engine  │ │  Engine  │ │  Engine  │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Data Layer                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Market Data Ingestion & Quality Control              │   │
│  │  (src/ingestion, src/preprocessing, src/markets)     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  External Data Sources                       │
│  Binance API | Yahoo Finance | Eastmoney | CoinGecko        │
│  AkShare | Stooq | Public Index Constituents                │
└─────────────────────────────────────────────────────────────┘
```

### 代码库规模
- **总Python文件数**: 62个核心源文件（src/目录）
- **总代码文件数**: 514个（包含测试、Web、配置等）
- **目录结构**: 
  - `src/`: 核心ML管道（19个子模块）
  - `dashboard/`: Streamlit仪表盘
  - `web/`: Web前端（HTML/CSS/JS）
  - `data/`: 数据存储（raw/processed/models）
  - `configs/`: 配置文件
  - `tests/`: 测试套件

---

## 🔧 核心技术栈详解

### 1. 数据工程技术栈

#### 数据采集层 (src/ingestion/)
**核心技术**: 多源异构数据融合 + 自动降级策略

```python
# 主要数据源及API端点
BINANCE_API:
  - https://api.binance.com/api/v3/klines
  - https://api.binance.com/api/v3/ticker/price
  
YAHOO_FINANCE:
  - https://query1.finance.yahoo.com/v7/finance/quote
  - https://query1.finance.yahoo.com/v8/finance/chart/{symbol}
  - https://query1.finance.yahoo.com/v10/finance/quoteSummary/{symbol}

EASTMONEY (A股实时):
  - https://push2.eastmoney.com/api/qt/stock/get

COINGECKO (加密市值):
  - https://api.coingecko.com/api/v3/coins/markets
  - https://api.coingecko.com/api/v3/simple/price

AKSHARE (A股成分股):
  - Python库，提供上证、沪深300等指数成分股数据
```

**技术亮点**:
- **自动降级**: Binance API失败时自动回退到合成数据
- **增量更新**: 支持从上次时间戳继续拉取，避免全量重跑
- **实时行情**: Crypto使用实时ticker（非收盘价），A股/美股优先使用实时API
- **时间戳标准化**: 统一UTC存储，按市场时区展示（加密/A股=北京时间，美股=纽约时间）

#### 数据质量保证 (src/preprocessing/quality.py)
**质量控制指标**:
```python
{
  "rows": int,                    # 总行数
  "latest_timestamp": str,        # 最新时间戳
  "missing_ratio": float,         # 缺失率
  "duplicate_ratio": float,       # 重复率
  "outlier_ratio_5sigma": float   # 5σ异常值比例
}
```

**数据清洗策略**:
- 缺失时间戳填充（优先重拉）
- 不插值伪造OHLC，使用`missing_flag`标记或丢弃
- Winsorization仅应用于特征，不修改原始价格

### 2. 特征工程技术栈

#### 特征分组体系 (src/features/build_features.py)

**A. 收益与动量特征**
```python
# Lagged Returns（滞后收益）
lag_returns = [1, 2, 4, 12, 24]  # 小时级
lag_returns = [1, 3, 7, 14]      # 日线级

# Rolling Mean Returns（滚动平均收益）
rolling_mean_return = [24, 72, 168]  # 小时级
rolling_mean_return = [7, 30, 90]    # 日线级
```

**B. 趋势特征**
```python
# EMA（指数移动平均）
ema_windows = [8, 20, 55, 144, 233]  # Fibonacci数列
close_to_ema_{w} = close / ema_{w} - 1.0

# MACD
macd_windows = [12, 26, 9]  # 快线/慢线/信号线
macd_line = EMA(close, 12) - EMA(close, 26)
macd_signal = EMA(macd_line, 9)
macd_hist = macd_line - macd_signal
```

**C. 波动率特征**
```python
# Rolling Volatility（滚动波动率）
rolling_vol_windows = [24, 72, 168]  # 小时级
rolling_vol_windows = [7, 30, 90]    # 日线级
ret_std_{w} = return_1.rolling(w).std()

# ATR（Average True Range）
atr_14 = _atr(df, period=14)

# Bollinger Bandwidth（布林带宽度）
bb_width = (upper - lower) / (ma + ε)
```

**D. 成交量特征**
```python
# Volume Change Rate（成交量变化率）
volume_ma_windows = [24, 72]  # 小时级
volume_ma_windows = [7, 30]   # 日线级

# OBV（On-Balance Volume）
obv = (sign(close.diff()) * volume).cumsum()
```

**E. 时间特征**
```python
# 小时级
hour_of_day, day_of_week

# 日线级
day_of_week, month
```

**F. 量化因子特征**
```python
# 风险因子
size_factor: 市值因子（市值对数）
value_factor: 价值因子（盈利/账面价值代理）
growth_factor: 成长因子（基本面增长或90日收益代理）

# 行为因子
momentum_factor: 动量因子（20日收益）
reversal_factor: 反转因子（-5日收益）
low_vol_factor: 低波动因子（-20日收益标准差）
```

**技术亮点**:
- **无泄露设计**: 所有指标仅使用时刻t及之前数据
- **配置驱动**: 窗口长度完全由config.yaml控制
- **Winsorization**: 对特征进行1%-99%分位数裁剪，减少异常值影响

### 3. 标签工程技术栈

#### 三重标签体系 (src/labels/build_labels.py)

**A. 方向分类标签 (Binary Classification)**
```python
# 未来收益计算
r(t, h) = (Close[t+h] - Close[t]) / Close[t]

# 方向标签
y_dir(t, h) = 1  if r(t, h) > 0
y_dir(t, h) = 0  otherwise
```

**B. 启动窗口预测标签 (Multiclass Classification)**
```python
# 启动事件定义（数据驱动阈值）
thr = quantile(abs(return), 0.8)  # 80分位数
τ = min { k : |r(t, k)| ≥ thr }   # 首次触发时刻

# 窗口分箱
小时级（未来4小时）:
  W0: no_start
  W1: 0-1h
  W2: 1-2h
  W3: 2-4h

日线级（未来7天）:
  W0: no_start
  W1: 0-1d
  W2: 1-3d
  W3: 3-7d
```

**C. 幅度区间预测标签 (Quantile Regression)**
```python
# 目标变量
y_ret(t, h) = r(t, h)

# 预测分位数
q10, q50, q90

# 可选增强：高低点预测
y_high(t, h) = (max High[next h] - Close[t]) / Close[t]
y_low(t, h) = (min Low[next h] - Close[t]) / Close[t]
```

**技术亮点**:
- **自适应阈值**: 基于历史数据自动计算启动阈值，避免主观设定
- **无泄露保证**: 严格使用未来数据仅用于标签生成
- **区间输出**: 提供q10/q50/q90区间，比点估计更实用

---

## 🤖 机器学习技术栈详解

### 1. 模型选择与架构

#### 基线模型 (Baseline Models)
```python
# 方向预测基线
- Naive: 前一柱方向延续
- Logistic Regression: class_weight="balanced"

# 启动窗口基线
- Most-frequent-class baseline
- Multinomial Logistic Regression (softmax)

# 幅度预测基线
- Naive: return = 0
- Linear Regression（可选）
```

#### MVP主模型 (Primary Models)
```python
# 模型后端选择
mvp_backend = "xgboost"  # lightgbm / xgboost / sklearn

# LightGBM配置示例
LGBMClassifier(
    n_estimators=240,
    learning_rate=0.03,
    num_leaves=63,
    max_depth=-1,
    subsample=0.8,
    colsample_bytree=0.8,
    reg_alpha=0.0,
    reg_lambda=0.0,
    device="gpu",  # GPU加速
    random_state=42
)

# XGBoost配置示例
XGBClassifier(
    n_estimators=240,
    learning_rate=0.03,
    max_depth=6,
    tree_method="hist",
    device="cuda",  # CUDA加速
    random_state=42
)

# 分位数回归（幅度预测）
LGBMRegressor(objective="quantile", alpha=q)
# 分别训练q10/q50/q90三个模型
```

**选择理由**:
- **LightGBM/XGBoost**: 训练速度快、稳定、可解释性强、工程风险低
- **分位数回归**: 提供预测区间，比点估计更实用
- **GPU加速**: 支持CUDA/OpenCL，大幅提升训练速度

#### 高级模型（可选）
```python
# Temporal Fusion Transformer (TFT)
框架: PyTorch Forecasting + PyTorch Lightning
优势: 
  - 多时间尺度预测能力强
  - 可解释性好（变量选择/注意力机制）
适用场景: 日线级预测（噪声较小）
```

### 2. 超参数优化 (HPO)

#### Optuna框架实现 (src/models/hpo.py)
```python
# 搜索空间
param_space = {
    "n_estimators": [120, 240, 360],
    "learning_rate": [0.01, 0.03, 0.05, 0.08],
    "num_leaves": [31, 63, 127],
    "subsample": [0.7, 0.8, 1.0],
    "colsample_bytree": [0.7, 0.8, 1.0],
    "reg_alpha": [0.0, 0.1, 0.5],
    "reg_lambda": [0.0, 0.1, 1.0]
}

# 两阶段优化
第一阶段: coarse_trials=4（粗搜索）
第二阶段: fine_trials=2（精细搜索，在最佳参数附近抖动）

# 早停机制
early_stopping_rounds = 100
num_boost_round ≤ 5000
```

**技术亮点**:
- **固定预算**: 日线30-50轮，小时级20-30轮
- **时间序列验证**: 在小规模时间切分子集上快速评分
- **抖动搜索**: 第二阶段在最佳参数附近局部探索

### 3. 模型训练与校准

#### 训练流程 (src/models/train.py)
```python
# 数据集切分
train_ratio = 0.8
holdout_ratio = 0.1（最后10%作为holdout）

# 训练步骤
1. 加载特征和标签数据
2. 切分训练集/验证集/holdout集
3. 训练三个独立模型：
   - 方向分类模型
   - 启动窗口多分类模型
   - 分位数回归模型（q10/q50/q90）
4. 保存模型快照（包含配置、指标、git commit hash）
```

#### 概率校准 (src/models/calibrate.py)
```python
# 校准方法
method = "sigmoid"  # Platt Scaling

# 校准流程
CalibratedClassifierCV(
    base_estimator=model,
    method="sigmoid",
    cv=3
)

# 校准指标
- Brier Score: B(y, p) = mean((y - p)²)
- Expected Calibration Error (ECE)
- Reliability Diagram
```

**技术亮点**:
- **类不平衡处理**: Logistic使用class_weight="balanced"，LightGBM使用scale_pos_weight
- **分位数交叉处理**: 如果q10 > q50，后处理排序修正
- **校准验证**: 生成Brier分数和ECE，确保概率输出可靠

### 4. Walk-Forward评估

#### 严格时间序列切分 (src/evaluation/walk_forward.py)
```python
# 切分策略
expanding_window = True  # 扩展窗口（推荐）
rolling_window = False   # 滚动窗口（可选）

# 防泄露间隙
gap = max_horizon  # 小时级gap=4，日线级gap=7

# Fold生成逻辑
for i in range(max_folds):
    train_end = min_train + i * test_size
    test_start = train_end + gap
    test_end = test_start + test_size
    if test_end > n: break
    folds.append({
        "fold": i,
        "train_start": 0,
        "train_end": train_end,
        "test_start": test_start,
        "test_end": test_end
    })
```

#### 评估指标体系
```python
# 方向预测指标
{
    "accuracy": float,
    "precision": float,
    "recall": float,
    "f1": float,
    "roc_auc": float
}

# 启动窗口指标
{
    "top1_accuracy": float,
    "top2_accuracy": float,
    "macro_f1": float
}

# 幅度预测指标
{
    "mae": float,
    "rmse": float,
    "pinball_loss_q10": float,
    "pinball_loss_q50": float,
    "pinball_loss_q90": float
}

# 区间指标
{
    "coverage": float,  # 真实值在[q10, q90]内的比例（目标≈80%）
    "width": float      # mean(q90 - q10)（越小越好，在保证覆盖率的前提下）
}

# 评估函数
def pinball_loss(y_true, y_pred, q):
    return max(q*(y_true-y_pred), (q-1)*(y_true-y_pred))
```

**技术亮点**:
- **Purged Walk-Forward**: 严格防止horizon重叠泄露
- **Fold级独立缩放**: 训练集fit，测试集transform，无信息泄露
- **区间评估**: 同时评估覆盖率和宽度，避免过窄或过宽的区间

---

## 📈 策略与执行技术栈

### 1. 策略信号生成 (src/models/policy.py)

#### 策略框架设计
```python
DEFAULT_POLICY_CONFIG = {
    "thresholds": {
        "p_bull": 0.55,      # 做多阈值
        "p_bear": 0.45,      # 做空阈值
        "ret_threshold": 0.002  # 收益阈值
    },
    "execution": {
        "fee_bps": 2.0,       # 手续费（基点）
        "slippage_bps": 5.0,  # 滑点（基点）
        "max_position": 1.0,  # 最大仓位
        "min_position": 0.01  # 最小仓位
    },
    "sizing": {
        "uncertainty_scale": 12.0,  # 不确定性缩放因子
        "confidence_power": 1.0      # 置信度幂次
    },
    "risk_scale": {
        "by_level": {
            "low": 1.0,
            "medium": 0.8,
            "high": 0.6,
            "extreme": 0.4
        }
    }
}
```

#### 仓位大小计算
```python
# 基于不确定性的仓位调整
uncertainty = q90 - q10  # 区间宽度
half_width_pct = max(uncertainty / 2, fallback_half_width_pct)
position_size = (expected_return / (uncertainty_scale * half_width_pct)) ** confidence_power
position_size = clip(position_size, min_position, max_position)

# 风险调整
risk_adjusted_position = position_size * risk_scale[risk_level]

# 市场规则调整
if market == "crypto":
    if side == "short" and not allow_short_perp:
        position = 0  # 不允许做空
```

#### 决策输出
```python
{
    "market": "crypto",
    "symbol": "BTCUSDT",
    "action": "long" / "short" / "flat",
    "signed_position": float,  # 正数=做多，负数=做空，0=观望
    "entry_price": float,
    "stop_loss": float,
    "take_profit_1": float,
    "take_profit_2": float,
    "expected_return_q50": float,
    "risk_to_sl": float,
    "net_edge_after_cost": float,
    "reason_codes": ["p_bull_gate", "volatility_gate", ...]
}
```

### 2. 新闻情绪门控 (src/features/news_features.py)

#### 新闻特征提取
```python
# 时间窗口
feature_windows_minutes = [30, 120, 1440]  # 30分钟/2小时/24小时

# 新闻情绪指标
{
    "news_score_30m": float,      # 30分钟加权情绪分数
    "news_score_120m": float,     # 2小时加权情绪分数
    "news_count_30m": int,        # 30分钟新闻条数
    "news_burst_zscore": float,   # 新闻爆发Z分数
    "news_pos_neg_ratio": float,  # 正负面比例
    "news_event_risk": float      # 事件风险分数
}

# 时间衰减
decay_tau_minutes = 360.0  # 6小时半衰期
weighted_score = Σ (score_i * exp(-Δt_i / decay_tau))
```

#### 门控规则
```python
NEWS_GATE_CONFIG = {
    "enabled": True,
    "negative_score_2h": -0.25,   # 2小时负面阈值
    "positive_score_2h": 0.25,    # 2小时正面阈值
    "burst_zscore": 1.5,          # 爆发Z分数阈值
    "score_30m_extreme": 0.40,    # 30分钟极端情绪阈值
    "count_30m_extreme": 3        # 30分钟极端新闻数量阈值
}

# 风险调整
if news_gate_blocked:
    risk_scale = 0.0  # 完全阻断
elif news_risk_level == "high":
    risk_scale = 0.70  # 降低30%仓位
```

### 3. 模拟K线生成 (src/markets/simulated_kline.py)

#### 蒙特卡洛模拟
```python
@dataclass
class SimulationConfig:
    n_steps: int = 24        # 模拟步数
    n_paths: int = 1000      # 模拟路径数
    seed: int = 42           # 随机种子（可复现）

# 模拟流程
1. 从session_forecast_profile获取每小时统计特征：
   - p_up（上涨概率）
   - q10/q50/q90（收益率分位数）
   
2. 对每条路径：
   - 根据p_up采样方向
   - 从[q10, q90]均匀采样幅度
   - OHLC约束：high >= max(open, close), low <= min(open, close)
   
3. 生成代表性路径：
   - 选择与中位数路径最接近的路径
   - 或使用分位数路径（q10/q50/q90）
```

#### TP/SL触发概率估计
```python
def estimate_tp_sl_hit_prob(
    profile: pd.DataFrame,
    current_price: float,
    tp_price: float,
    sl_price: float,
    n_simulations: int = 1000
) -> Dict[str, float]:
    """
    估算止盈止损触发概率
    返回: {
        "tp_hit_prob": float,
        "sl_hit_prob": float,
        "neither_prob": float,
        "expected_steps": float
    }
    """
```

---

## 🔄 回测与监控技术栈

### 1. 回测引擎 (src/evaluation/backtest.py)

#### 回测流程
```python
# 信号生成
signal_raw = 1   if p_up > up_thr (0.55)
signal_raw = -1  if p_up < down_thr (0.45)
signal_raw = 0   otherwise

# 执行延迟（防泄露）
position[t] = signal_raw[t-1]  # t时刻信号，t+1时刻执行

# 成本模型
fee_bps = 10.0      # 手续费10基点
slippage_bps = 10.0  # 滑点10基点
impact_bps = 1.0     # 市场冲击1基点
total_cost = (fee_bps + slippage_bps + impact_bps) / 10000.0

# 收益计算
turnover = |position[t] - position[t-1]|
strategy_ret = position[t] * market_ret[t] - turnover * total_cost
equity = cumprod(1 + strategy_ret)
```

#### 绩效指标
```python
{
    "total_return": float,           # 总收益
    "annualized_return": float,      # 年化收益
    "max_drawdown": float,           # 最大回撤
    "sharpe": float,                 # 夏普比率
    "win_rate": float,               # 胜率
    "profit_factor": float,          # 盈亏比
    "num_trades": int                # 交易次数
}

# 年化因子
小时级: sqrt(24 * 365) ≈ 93.2
日线级: sqrt(365) ≈ 19.1

sharpe = mean(strategy_ret) / std(strategy_ret) * annualization_factor
```

### 2. 多市场回测 (src/evaluation/backtest_multi_market.py)

#### 统一回测框架
```python
# 市场配置
markets = ["crypto", "cn_equity", "us_equity"]

# 市场特定规则
market_rules = {
    "crypto": {
        "trading_hours": "24/7",
        "allow_short": True,
        "fee_bps": 10
    },
    "cn_equity": {
        "trading_hours": "09:30-11:30, 13:00-15:00",
        "allow_short": False,
        "fee_bps": 15
    },
    "us_equity": {
        "trading_hours": "09:30-16:00 ET",
        "allow_short": True,
        "fee_bps": 5
    }
}

# 统一输出
{
    "trades.csv": "所有市场交易记录",
    "equity.csv": "权益曲线",
    "metrics_by_fold.csv": "分折指标",
    "metrics_summary.csv": "汇总指标",
    "compare_baselines.csv": "基线对比"
}
```

### 3. 漂移监控 (src/monitoring/drift.py)

#### PSI（Population Stability Index）
```python
def compute_psi(base: pd.Series, recent: pd.Series, bins: int = 10) -> float:
    """
    计算特征漂移指标
    PSI < 0.1: 稳定（green）
    0.1 <= PSI < 0.25: 轻微漂移（yellow）
    0.25 <= PSI < 0.4: 中度漂移（orange）
    PSI >= 0.4: 严重漂移（red）
    """
```

#### KS距离（Kolmogorov-Smirnov）
```python
def ks_distance(base: pd.Series, recent: pd.Series) -> float:
    """
    计算累积分布函数最大距离
    衡量两个分布的差异
    """
```

#### 监控维度
```python
# 特征漂移
- 对每个特征计算PSI和KS距离
- 生成drift_monitor_daily.csv

# 指标漂移
- 从backtest folds提取指标时间序列
- 检测指标退化趋势

# 模型状态
- 训练时间戳
- 数据新鲜度
- 建议重训阈值
```

### 4. 模型退休机制 (src/monitoring/retirement.py)

#### 退休判定规则
```python
# 硬性指标
if any([
    drift_count_red > 0,
    sharpe_recent < threshold,
    holdout_performance_drop > max_drop,
    data_age_days > max_age
]):
    retire_model = True
    recommendation = "retrain_immediately"

# 软性指标
if all([
    drift_count_yellow > 5,
    performance_declining_trend,
    confidence_interval_widening
]):
    retire_model = True
    recommendation = "schedule_retrain"
```

---

## 🌐 前端技术栈详解

### 1. Streamlit仪表盘 (dashboard/app.py)

#### 架构设计
```python
# 页面路由
pages = {
    "Crypto Overview": "加密市场概览",
    "CN A-share": "A股市场",
    "US Equity": "美股市场",
    "Session Forecast": "交易时段预测",
    "Selection & Research": "选股与研究",
    "Tracking": "跟踪与监控",
    "Paper Trading": "纸上交易",
    "Execution": "执行记录"
}

# 缓存策略
@st.cache_data(ttl=600, show_spinner=False)
def load_data():
    """10分钟缓存，减少API调用"""

# 国际化
ui_lang = "zh" or "en"
def _t(zh_text: str, en_text: str) -> str:
    return zh_text if ui_lang == "zh" else en_text
```

#### 可视化组件
```python
# 使用Plotly Interactive Charts
- 价格K线图（Candlestick）
- 预测区间带（Prediction Band）
- 权益曲线（Equity Curve）
- 热力图（Heatmap）
- 指标表格（Metrics Table）

# 实时更新
refresh_interval = 60  # 秒
auto_refresh = st.checkbox("Enable Auto Refresh")
```

### 2. Web前端 (web/)

#### 技术栈
```
HTML5 + CSS3 + JavaScript (Vanilla)
Chart.js (可视化库)
Fetch API (数据请求)
LocalStorage (用户偏好)
```

#### API客户端 (web/js/api.js)
```javascript
// API基础URL配置
const API_BASE_URL = 
    window.location.hostname === "localhost"
    ? "http://127.0.0.1:5001/api"
    : `${window.location.origin}/api`;

// 统一请求处理
async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${localStorage.getItem("token")}`
    };
    // 错误处理、重试、超时等
}

// 数据规范化
function normalizeSignal(payload) {
    // 将confidence从0-1转换为0-100
    // 统一字段命名
    // 处理缺失值
}
```

#### 页面模块
```javascript
// 加密时段预测页面 (web/js/session-crypto.js)
- 实时价格展示
- 时段预测卡片
- 决策矩阵
- 模拟K线图
- 模型健康度指示器

// A股页面 (web/js/cn-equity.js)
- 沪深300成分股快照
- 实时行情更新
- 预测对比

// 美股页面 (web/js/us-equity.js)
- 道琼斯/纳指/标普成分股
- 时区转换（北京/纽约）
- 市场开闭状态
```

---

## 📦 数据存储与版本管理

### 1. 数据目录结构
```
data/
├── raw/                          # 原始数据
│   ├── btcusdt_hourly.csv
│   ├── btcusdt_daily.csv
│   └── ...
├── processed/                    # 处理后数据
│   ├── features_hourly.csv
│   ├── features_daily.csv
│   ├── labels_hourly.csv
│   ├── labels_daily.csv
│   ├── backtest/                 # 回测结果
│   │   ├── trades.csv
│   │   ├── equity.csv
│   │   ├── metrics_by_fold.csv
│   │   └── metrics_summary.csv
│   ├── tracking/                 # 跟踪数据
│   │   ├── universe_crypto.json
│   │   ├── universe_ashares.json
│   │   ├── universe_us.json
│   │   ├── ranked_universe.csv
│   │   └── tracking_actions.csv
│   ├── news/                     # 新闻数据
│   │   ├── news_raw.csv
│   │   └── news_features_hourly.csv
│   ├── policy_signals_*.csv      # 策略信号
│   ├── drift_monitor_daily.csv   # 漂移监控
│   ├── model_status.csv          # 模型状态
│   └── go_live_decision.json     # 上线决策
└── models/                       # 模型存储
    ├── 2026-02-06_041730_daily/
    │   ├── artifact_meta.json
    │   ├── config_snapshot.yaml
    │   ├── direction_h1_mvp.pkl
    │   ├── start_window_mvp.pkl
    │   ├── ret_h1_q0.1_mvp.pkl
    │   ├── ret_h1_q0.5_mvp.pkl
    │   ├── ret_h1_q0.9_mvp.pkl
    │   └── metrics.csv
    └── 2026-02-06_041730_hourly/
        └── ...
```

### 2. 模型版本管理
```yaml
# artifact_meta.json
{
  "model_version": "baseline_momentum_quantile",
  "git_commit": "072df35",
  "config_hash": "1332dfca439eec8...",
  "data_hash": "a8ef06459e7a234...",
  "training_timestamp": "2026-02-06T04:17:30Z",
  "seed": 42,
  "branch": "daily",
  "horizons": ["h1", "h3", "h7"]
}

# config_snapshot.yaml
# 训练时完整配置快照，确保可复现
```

### 3. 治理产物
```json
// data_integrity_checks.json
{
  "timestamp": "2026-02-11T12:56:25Z",
  "checks": {
    "missing_ratio": 0.001,
    "duplicate_ratio": 0.0,
    "outlier_ratio": 0.02,
    "calendar_alignment": "PASS",
    "timezone_consistency": "PASS"
  }
}

// go_live_decision.json
{
  "decision": "IN REVIEW",
  "reasons": [
    "drift_red_count: 47 (threshold: 0)",
    "sharpe_crypto: -0.36 (threshold: 0.8)",
    "sharpe_std: 2.30 (threshold: 0.35)"
  ],
  "recommendations": [
    "Retrain with recent data",
    "Reduce position sizing",
    "Add drift robustness features"
  ]
}
```

---

## 🚀 部署与运维

### 1. 一键运行脚本
```powershell
# scripts/run_pipeline.ps1
# 完整流水线一键执行

# 1. 数据采集
python -m src.ingestion.update_data --config configs/config.yaml

# 2. 数据验证
python -m src.preprocessing.validate_data --config configs/config.yaml

# 3. 特征工程
python -m src.features.build_features --config configs/config.yaml

# 4. 标签生成
python -m src.labels.build_labels --config configs/config.yaml

# 5. 时间切分
python -m src.split.build_folds --config configs/config.yaml

# 6. 超参数优化
python -m src.models.hpo --config configs/config.yaml

# 7. 模型训练
python -m src.models.train --config configs/config.yaml

# 8. 模型校准
python -m src.models.calibrate --config configs/config.yaml

# 9. 预测生成
python -m src.models.predict --config configs/config.yaml

# 10. 策略信号
python -m src.models.generate_policy_signals --config configs/config.yaml

# 11. 回测评估
python -m src.evaluation.walk_forward --config configs/config.yaml
python -m src.evaluation.backtest --config configs/config.yaml
python -m src.evaluation.backtest_multi_market --config configs/config.yaml

# 12. 漂移监控
python -m src.monitoring.drift --config configs/config.yaml
python -m src.monitoring.retirement --config configs/config.yaml

# 13. 报告导出
python -m src.reporting.export_report --config configs/config.yaml

# 14. 启动仪表盘
streamlit run dashboard/app.py --server.port 8501
```

### 2. 配置驱动架构
```yaml
# configs/config.yaml 核心配置示例

project:
  name: "BTC Trend & Volatility Forecast"
  seed: 42

paths:
  raw_data_dir: "data/raw"
  processed_data_dir: "data/processed"
  models_dir: "data/models"

data:
  source: "binance"
  symbol: "BTCUSDT"
  
  branches:
    hourly:
      interval: "1h"
      lookback_days: 1825
      market_tz: "Asia/Shanghai"
      horizons: [1, 2, 4]
      
    daily:
      interval: "1d"
      lookback_days: 1825
      market_tz: "Asia/Shanghai"
      horizons: [1, 3, 7]

models:
  mvp_backend: "xgboost"  # lightgbm / xgboost / sklearn
  gpu:
    enabled: true
    fallback_to_cpu: true
    
  classifier:
    n_estimators: 240
    learning_rate: 0.03
    num_leaves: 63
    
  regressor:
    n_estimators: 240
    learning_rate: 0.03

backtest:
  p_up_long: 0.55
  p_up_short: 0.45
  fee_bps: 10.0
  slippage_bps: 10.0
```

---

## 🔬 项目特色与创新点

### 1. 严格的无泄露设计
- **时间序列切分**: Walk-Forward评估，gap=max_horizon防止重叠泄露
- **特征工程**: 所有特征仅使用时刻t及之前数据
- **执行延迟**: 信号在t时刻生成，t+1时刻执行
- **Fold级独立缩放**: 训练集fit，测试集transform

### 2. 数据驱动的阈值设定
- **启动阈值**: 基于历史数据80分位数，非主观设定
- **时间窗口**: 数据驱动的窗口划分（W0/W1/W2/W3）
- **自适应参数**: 根据市场状态动态调整

### 3. 多重预测输出
- **方向概率**: P(up) / P(down)
- **启动窗口**: W0/W1/W2/W3概率分布
- **幅度区间**: q10/q50/q90分位数预测
- **区间评估**: 同时评估覆盖率和宽度

### 4. 完整的治理框架
- **数据质量报告**: 每次更新生成质量检查
- **漂移监控**: PSI + KS距离双重监控
- **模型版本管理**: 时间戳+配置快照+git hash
- **上线决策**: 自动化状态判定（IN REVIEW/GO）

### 5. 多市场统一框架
- **市场无关架构**: 同一套代码支持多市场
- **时区标准化**: UTC存储+市场时区展示
- **交易日历对齐**: 处理不同市场交易时间差异

---

## 📊 当前性能与问题

### 1. 当前评估快照（2026-02-11）
```
小时级方向准确率: 0.507 ~ 0.523（略优于随机）
日线方向准确率: 最高达 0.670（长周期）
Brier Score: 0.24-0.28（校准良好）
ECE（Expected Calibration Error）: 0.05-0.08
区间覆盖率: 78-82%（接近目标80%）
```

### 2. 当前问题（评估原因）
```
❌ 漂移告警: 47个red级别告警（阈值0）
❌ 夏普比率: 
   - Crypto: -0.36（目标>=0.8）
   - CN Equity: 不适用（禁止做空）
   - US Equity: -1.06（目标>=0.8）
   
❌ 夏普稳定性: 跨折标准差过大
   - Crypto: 2.30（目标<=0.35）
   - CN: 1.89（目标<=0.35）
   - US: 2.05（目标<=0.35）

✅ 最大回撤: 各市场均满足阈值
✅ 盈亏比: 基本达标
✅ 交易次数: 充足（>100）
```

### 3. 问题根因分析
```
1. 市场噪声: 小时级数据噪声过大，模型难以捕捉有效信号
2. 特征漂移: 市场状态变化导致特征分布偏移
3. 过拟合: 训练数据与实时市场存在gap
4. 成本侵蚀: 手续费+滑点侵蚀收益，尤其高频策略
5. 新闻冲击: 突发新闻导致短期价格剧烈波动，模型未充分响应
```

---

## 🎯 改进路线图

### 短期优化（1-2周）
```
1. 特征工程增强:
   - 添加市场微观结构特征（订单流、买卖盘差）
   - 引入跨市场联动特征（BTC vs ETH相关性）
   - 强化波动率聚类特征（GARCH类模型）

2. 模型鲁棒性:
   - 实施对抗训练（Adversarial Training）
   - 添加Dropout正则化
   - 集成多模型（Ensemble）

3. 漂移适应:
   - 在线学习（Online Learning）
   - 滑动窗口重训（Rolling Retrain）
   - 特征选择自适应
```

### 中期优化（1-2月）
```
1. 高级模型探索:
   - Temporal Fusion Transformer（TFT）
   - N-BEATS / N-HiTS
   - 多任务学习架构

2. 强化学习:
   - DQN / PPO用于仓位管理
   - 环境建模（Market Simulator）

3. 新闻深度整合:
   - FinBERT情感分析
   - 事件抽取（Event Extraction）
   - 知识图谱关联
```

### 长期愿景（3-6月）
```
1. 实盘部署:
   - 连接交易所API（Binance/Bybit）
   - 实时风控系统
   - 资金管理系统

2. 多策略组合:
   - 趋势跟踪 + 均值回归
   - 统计套利
   - 做市策略

3. 智能监控:
   - 异常检测（Anomaly Detection）
   - 自动降级机制
   - 人工介入接口
```

---

## 🔍 关键代码示例

### 1. 完整预测流程示例
```python
# 加载配置
config = load_config("configs/config.yaml")

# 加载最新模型
model_dir = Path("data/models/2026-02-06_041730_daily")
direction_model = load_model(model_dir / "direction_h1_mvp.pkl")
quantile_q10 = load_model(model_dir / "ret_h1_q0.1_mvp.pkl")
quantile_q50 = load_model(model_dir / "ret_h1_q0.5_mvp.pkl")
quantile_q90 = load_model(model_dir / "ret_h1_q0.9_mvp.pkl")

# 获取实时数据
df = fetch_binance_klines("BTCUSDT", "1h", lookback=500)

# 特征工程
features = build_features(df, config)

# 预测
p_up = direction_model.predict_proba(features[-1:])[:, 1][0]
q10 = quantile_q10.predict(features[-1:])[0]
q50 = quantile_q50.predict(features[-1:])[0]
q90 = quantile_q90.predict(features[-1:])[0]

# 生成策略信号
signal = {
    "symbol": "BTCUSDT",
    "timestamp": pd.Timestamp.now(tz="UTC"),
    "current_price": df["close"].iloc[-1],
    "p_up": p_up,
    "q10_change": q10,
    "q50_change": q50,
    "q90_change": q90,
    "predicted_price": df["close"].iloc[-1] * (1 + q50)
}

# 应用策略规则
policy = apply_policy_frame(signal, config)
print(f"Action: {policy['action']}")
print(f"Position Size: {policy['signed_position']}")
```

### 2. 自定义特征示例
```python
def add_custom_features(df: pd.DataFrame) -> pd.DataFrame:
    """添加自定义特征"""
    
    # 市场微观结构
    df["bid_ask_spread"] = df["high"] - df["low"]
    df["close_to_mid"] = (df["close"] - (df["high"] + df["low"]) / 2) / df["close"]
    
    # 成交量加权价格
    df["vwap"] = (df["close"] * df["volume"]).rolling(20).sum() / df["volume"].rolling(20).sum()
    df["close_to_vwap"] = df["close"] / df["vwap"] - 1
    
    # 波动率聚类
    df["vol_cluster"] = pd.qcut(df["close"].pct_change().rolling(20).std(), 
                                  q=5, labels=False, duplicates="drop")
    
    # 跨周期动量
    df["momentum_1h_4h"] = df["close"].pct_change(1) - df["close"].pct_change(4)
    
    return df
```

### 3. 回测可视化示例
```python
import plotly.graph_objects as go
from plotly.subplots import make_subplots

def plot_backtest_results(equity: pd.DataFrame, trades: pd.DataFrame):
    """绘制回测结果"""
    
    fig = make_subplots(
        rows=3, cols=1,
        subplot_titles=("Equity Curve", "Drawdown", "Monthly Returns"),
        row_heights=[0.5, 0.25, 0.25]
    )
    
    # 权益曲线
    fig.add_trace(
        go.Scatter(x=equity["timestamp"], y=equity["equity"], 
                   name="Equity", line=dict(color="blue")),
        row=1, col=1
    )
    
    # 回撤
    peak = equity["equity"].cummax()
    drawdown = (equity["equity"] / peak - 1) * 100
    fig.add_trace(
        go.Scatter(x=equity["timestamp"], y=drawdown,
                   name="Drawdown %", fill="tozeroy",
                   line=dict(color="red")),
        row=2, col=1
    )
    
    # 月度收益
    monthly_ret = equity.set_index("timestamp")["equity"].resample("M").last().pct_change() * 100
    fig.add_trace(
        go.Bar(x=monthly_ret.index, y=monthly_ret.values,
               name="Monthly Return %",
               marker_color=["green" if x > 0 else "red" for x in monthly_ret.values]),
        row=3, col=1
    )
    
    fig.update_layout(height=900, showlegend=True)
    return fig
```

---

## 📚 参考文献与资源

### 学术论文
1. **Quantile Regression for Financial Risk**: Koenker & Bassett (1978)
2. **Temporal Fusion Transformer**: Lim et al. (2021)
3. **Walk-Forward Validation for Time Series**: Bergmeir et al. (2018)
4. **PSI for Model Monitoring**: Siddiqi (2006)

### 开源项目
1. **PyTorch Forecasting**: https://github.com/jdb78/pytorch-forecasting
2. **LightGBM**: https://github.com/microsoft/LightGBM
3. **Optuna**: https://github.com/optuna/optuna
4. **Streamlit**: https://github.com/streamlit/streamlit

### 数据源
1. **Binance API**: https://binance-docs.github.io/apidocs/
2. **Yahoo Finance**: https://finance.yahoo.com/
3. **CoinGecko API**: https://www.coingecko.com/api/documentations/v3
4. **AkShare**: https://github.com/akfamily/akshare

---

## 🎓 总结

### 项目优势
✅ **架构完整**: 端到端流水线，从数据到决策全覆盖  
✅ **技术先进**: Walk-Forward、分位数回归、漂移监控等前沿技术  
✅ **工程规范**: 配置驱动、版本管理、自动化测试  
✅ **可扩展性**: 多市场、多时间框架、多模型支持  
✅ **可解释性**: 策略规则清晰，决策逻辑透明  

### 待改进点
⚠️ **预测性能**: 当前模型夏普比率未达标，需增强特征和模型  
⚠️ **漂移鲁棒性**: 需要更强大的漂移适应机制  
⚠️ **实盘对接**: 尚未连接真实交易所API  
⚠️ **新闻集成**: 新闻情绪特征尚未充分训练  
⚠️ **成本优化**: 高频策略手续费侵蚀严重，需优化执行  

### 适用场景
🎯 **研究工作台**: 多市场资产研究与筛选  
🎯 **策略验证**: Paper Trading决策控制台  
🎯 **模型监控**: 漂移检测与治理驾驶舱  
🎯 **教学演示**: 量化金融全流程展示  

---

**文档生成时间**: 2026-03-02  
**文档版本**: v1.0  
**项目状态**: Paper Trading IN REVIEW（持续评估中）  
**下一步行动**: 重训+校准+漂移鲁棒性改进  

---

**致谢**: 本项目参考了大量学术研究和开源项目，感谢社区的贡献！
