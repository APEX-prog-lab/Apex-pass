'use strict';

const MAX_FINDINGS_PER_TYPE = 5;
const FVG_LOOKBACK_CANDLES = 120;
const SWEEP_LOOKBACK_CANDLES = 40;
const BREAK_LOOKBACK_CANDLES = 80;
const DISPLACEMENT_AVERAGE_CANDLES = 20;

const isValidCandle = candle =>
    candle &&
    Number.isFinite(candle.open_time) &&
    Number.isFinite(candle.close_time) &&
    [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) &&
    candle.open > 0 &&
    candle.low > 0 &&
    candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close, candle.high) &&
    candle.volume >= 0;

const asIso = timestamp => new Date(timestamp).toISOString();

const isPivotHigh = (candles, index) => {
    const pivot = candles[index].high;
    return candles.slice(index - 2, index + 3)
        .every((candle, offset) => offset === 2 || pivot > candle.high);
};

const isPivotLow = (candles, index) => {
    const pivot = candles[index].low;
    return candles.slice(index - 2, index + 3)
        .every((candle, offset) => offset === 2 || pivot < candle.low);
};

const findFvgs = (candles, interval) => {
    const firstIndex = Math.max(2, candles.length - FVG_LOOKBACK_CANDLES);
    const findings = [];

    for (let index = firstIndex; index < candles.length; index += 1) {
        const first = candles[index - 2];
        const third = candles[index];
        let direction;
        let lower;
        let upper;

        if (first.high < third.low) {
            direction = 'bullish';
            lower = first.high;
            upper = third.low;
        } else if (first.low > third.high) {
            direction = 'bearish';
            lower = third.high;
            upper = first.low;
        } else {
            continue;
        }

        const fullyMitigated = candles.slice(index + 1).some(candle =>
            direction === 'bullish' ? candle.low <= lower : candle.high >= upper
        );
        if (fullyMitigated) continue;

        findings.push({
            direction,
            interval,
            zone_minim_usd: lower,
            zone_maxim_usd: upper,
            start_time_ms: first.open_time,
            detection_time_ms: third.close_time,
            start_time_utc: asIso(first.open_time),
            detection_time_utc: asIso(third.close_time),
            candles: [first.open_time, candles[index - 1].open_time, third.open_time],
            status: 'unfilled_in_available_history'
        });
    }

    return findings.slice(-MAX_FINDINGS_PER_TYPE);
};

const findLiquiditySweeps = (candles, interval) => {
    const firstRecentIndex = Math.max(4, candles.length - SWEEP_LOOKBACK_CANDLES);
    const findings = [];
    const seenPivots = new Set();

    for (let index = firstRecentIndex; index < candles.length; index += 1) {
        const candle = candles[index];
        const confirmedHighs = [];
        const confirmedLows = [];
        for (let pivotIndex = 2; pivotIndex <= index - 3; pivotIndex += 1) {
            if (isPivotHigh(candles, pivotIndex)) confirmedHighs.push({ candle: candles[pivotIndex], index: pivotIndex });
            if (isPivotLow(candles, pivotIndex)) confirmedLows.push({ candle: candles[pivotIndex], index: pivotIndex });
        }

        const pivotHigh = confirmedHighs.slice().reverse()
            .find(candidate =>
                candle.high > candidate.candle.high &&
                candle.close < candidate.candle.high
            );
        if (pivotHigh) {
            const key = `high:${pivotHigh.candle.open_time}`;
            if (!seenPivots.has(key)) {
                findings.push({
                    direction: 'high',
                    interval,
                    swept_level_usd: pivotHigh.candle.high,
                    wick_extreme_usd: candle.high,
                    candle_close_usd: candle.close,
                    candle_time_ms: candle.open_time,
                    detection_time_ms: candle.close_time,
                    pivot_time_utc: asIso(pivotHigh.candle.open_time),
                    detection_time_utc: asIso(candle.close_time),
                    candle_time_utc: asIso(candle.open_time)
                });
                seenPivots.add(key);
            }
        }

        const pivotLow = confirmedLows.slice().reverse()
            .find(candidate =>
                candle.low < candidate.candle.low &&
                candle.close > candidate.candle.low
            );
        if (pivotLow) {
            const key = `low:${pivotLow.candle.open_time}`;
            if (!seenPivots.has(key)) {
                findings.push({
                    direction: 'low',
                    interval,
                    swept_level_usd: pivotLow.candle.low,
                    wick_extreme_usd: candle.low,
                    candle_close_usd: candle.close,
                    candle_time_ms: candle.open_time,
                    detection_time_ms: candle.close_time,
                    pivot_time_utc: asIso(pivotLow.candle.open_time),
                    detection_time_utc: asIso(candle.close_time),
                    candle_time_utc: asIso(candle.open_time)
                });
                seenPivots.add(key);
            }
        }
    }

    return findings.slice(-MAX_FINDINGS_PER_TYPE);
};

const averageBodySize = (candles, endIndex) => {
    const startIndex = Math.max(0, endIndex - DISPLACEMENT_AVERAGE_CANDLES);
    const bodies = candles.slice(startIndex, endIndex)
        .map(candle => Math.abs(candle.close - candle.open));
    return bodies.length
        ? bodies.reduce((total, body) => total + body, 0) / bodies.length
        : 0;
};

const findOrderBlocks = (candles, interval) => {
    const firstRecentIndex = Math.max(3, candles.length - BREAK_LOOKBACK_CANDLES);
    const findings = [];

    for (let index = firstRecentIndex; index < candles.length; index += 1) {
        const candle = candles[index];
        const candleBody = Math.abs(candle.close - candle.open);
        const candleRange = candle.high - candle.low;
        const meanBody = averageBodySize(candles, index);
        if (candleRange <= 0 || meanBody <= 0 ||
            candleBody < meanBody * 1.5 || candleBody / candleRange < 0.6) {
            continue;
        }

        let pivotHigh = null;
        let pivotLow = null;
        for (let pivotIndex = 2; pivotIndex <= index - 3; pivotIndex += 1) {
            if (isPivotHigh(candles, pivotIndex)) pivotHigh = candles[pivotIndex];
            if (isPivotLow(candles, pivotIndex)) pivotLow = candles[pivotIndex];
        }

        const bullishBreak = candle.close > candle.open &&
            pivotHigh &&
            candles[index - 1].close <= pivotHigh.high &&
            candle.close > pivotHigh.high;
        const bearishBreak = candle.close < candle.open &&
            pivotLow &&
            candles[index - 1].close >= pivotLow.low &&
            candle.close < pivotLow.low;
        if (!bullishBreak && !bearishBreak) continue;

        const direction = bullishBreak ? 'bullish' : 'bearish';
        let origin = null;
        for (let originIndex = index - 1; originIndex >= Math.max(0, index - 5); originIndex -= 1) {
            const candidate = candles[originIndex];
            const opposingCandle = direction === 'bullish'
                ? candidate.close < candidate.open
                : candidate.close > candidate.open;
            if (opposingCandle) {
                origin = candidate;
                break;
            }
        }
        if (!origin) continue;

        findings.push({
            direction,
            interval,
            break_type: 'BOS_proxy',
            zone_minim_usd: origin.low,
            zone_maxim_usd: origin.high,
            origin_time_ms: origin.open_time,
            detection_time_ms: candle.close_time,
            origin_time_utc: asIso(origin.open_time),
            detection_time_utc: asIso(candle.close_time),
            broken_swing_usd: bullishBreak ? pivotHigh.high : pivotLow.low,
            displacement_body_to_average: Number((candleBody / meanBody).toFixed(4)),
            displacement_body_to_range: Number((candleBody / candleRange).toFixed(4))
        });
    }

    return findings.slice(-MAX_FINDINGS_PER_TYPE);
};

const detectSmcStructures = (candlesByInterval = {}) => {
    const intervals = {};

    for (const [interval, inputCandles] of Object.entries(candlesByInterval)) {
        const candles = (Array.isArray(inputCandles) ? inputCandles : [])
            .filter(isValidCandle)
            .sort((first, second) => first.open_time - second.open_time);

        intervals[interval] = {
            candle_count: candles.length,
            last_closed_candle_utc: candles.length
                ? asIso(candles[candles.length - 1].close_time)
                : null,
            fair_value_gaps: findFvgs(candles, interval),
            liquidity_sweeps: findLiquiditySweeps(candles, interval),
            order_blocks: findOrderBlocks(candles, interval)
        };
    }

    return {
        methodology: {
            fvg: 'Three closed candles; bullish when first.high < third.low, bearish when first.low > third.high. Fully filled gaps in the available later candle history are excluded.',
            liquidity_sweep: 'The wick exceeds the latest confirmed two-left/two-right swing level while the candle closes back across that level.',
            order_block: 'The last opposing candle within five bars before a confirmed swing break; break candle body is at least 1.5x the prior-20-candle mean body and at least 60% of its range. BOS is a mechanical close-through proxy, not a discretionary structure classification.',
            history_scope: 'Only the supplied closed Binance candles are evaluated; absence of a result does not prove the structure never occurred.'
        },
        intervals
    };
};

module.exports = { detectSmcStructures };
