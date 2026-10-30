'use strict';

const { randomUUID } = require('crypto');

const SUPPORT_COLOR = '#00F3B7';
const RESISTANCE_COLOR = '#FF3B69';
const ATH_COLOR = '#FFD700';
const ENTRY_COLOR = '#4DA3FF';
const STOP_COLOR = '#FF3B69';
const TARGET_COLOR = '#00F3B7';
const BULLISH_FVG_COLOR = '#35C98A';
const BEARISH_FVG_COLOR = '#E76F51';
const BULLISH_OB_COLOR = '#4C9AFF';
const BEARISH_OB_COLOR = '#A855F7';
const SWEEP_COLOR = '#F5B942';
const INTERVAL_PRIORITY = new Map([
    ['1h', 0],
    ['4h', 1],
    ['1d', 2],
    ['1w', 3],
    ['1m', 4],
    ['1y', 5]
]);
const MAX_DRAWINGS_PER_SIDE = 4;

const toPositiveNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
};

const formatPrice = (price) => new Intl.NumberFormat('en-US', {
    minimumFractionDigits: price < 1 ? 4 : 2,
    maximumFractionDigits: price < 1 ? 6 : 2
}).format(price);

const formatRiskReward = (riskReward) => Number(riskReward.toFixed(4)).toString();

const addDrawingMetadata = (drawing, color) => ({
    ...drawing,
    culoare_hex: color,
    culoare: color,
    culore: color
});

const createLevelCallout = (drawing) => addDrawingMetadata({
    id: randomUUID(),
    tip_forma: 'callout_badge',
    categoria: `level_annotation_${drawing.categoria}`,
    tip: 'level_annotation',
    interval: drawing.interval,
    pret_minim: drawing.pret_minim,
    pret_maxim: drawing.pret_maxim,
    zone_minim_usd: drawing.zone_minim_usd,
    zone_maxim_usd: drawing.zone_maxim_usd,
    coordonate: {
        x: 0,
        y_minim_usd: drawing.pret_minim,
        y_maxim_usd: drawing.pret_maxim
    },
    eticheta: drawing.eticheta,
    animat: false
}, drawing.culoare_hex);

const hasSamePriceArea = (first, second, reference) => {
    const overlap = first.pret_minim <= second.pret_maxim && second.pret_minim <= first.pret_maxim;
    const firstCenter = (first.pret_minim + first.pret_maxim) / 2;
    const secondCenter = (second.pret_minim + second.pret_maxim) / 2;
    return overlap || Math.abs(firstCenter - secondCenter) / reference <= 0.0035;
};

const selectPriorityZones = (zones, reference) => {
    const prioritized = [...zones].sort((first, second) =>
        second.priority - first.priority ||
        Math.abs(first.center - reference) - Math.abs(second.center - reference)
    );
    const selected = [];

    for (const zone of prioritized) {
        if (selected.some(existing => hasSamePriceArea(existing, zone, reference))) continue;
        selected.push(zone);
    }

    return selected
        .sort((first, second) => Math.abs(first.center - reference) - Math.abs(second.center - reference))
        .slice(0, MAX_DRAWINGS_PER_SIDE);
};

const genereazaElementeGrafice = (niveluriTehnice = {}, datePiață = {}) => {
    const referinta = toPositiveNumber(
        datePiață.media_piata_usd ?? niveluriTehnice.intrare_referinta_usd
    );
    const candidates = { support: [], resistance: [] };

    for (const [intervalCheie, niveluri] of Object.entries(niveluriTehnice.intervale || {})) {
        const interval = niveluri?.interval || intervalCheie;
        const intervalRank = INTERVAL_PRIORITY.get(intervalCheie) ?? 0;
        const categorii = [
            { zone: niveluri?.zone_suport, categorie: 'support', culoare: SUPPORT_COLOR, denumire: 'Suport' },
            { zone: niveluri?.zone_rezistenta, categorie: 'resistance', culoare: RESISTANCE_COLOR, denumire: 'Rezistență' }
        ];

        for (const { zone, categorie, culoare, denumire } of categorii) {
            for (const zona of Array.isArray(zone) ? zone : []) {
                const pretMinim = toPositiveNumber(zona?.minim_usd);
                const pretMaxim = toPositiveNumber(zona?.maxim_usd);
                if (pretMinim === null || pretMaxim === null || pretMaxim < pretMinim) continue;

                const atingeri = Number.isInteger(Number(zona.atingeri_pivot)) && Number(zona.atingeri_pivot) > 0
                    ? Number(zona.atingeri_pivot)
                    : 0;
                const centru = toPositiveNumber(zona.centru_usd) || (pretMinim + pretMaxim) / 2;
                if (referinta === null) continue;
                if (categorie === 'support' ? pretMaxim >= referinta : pretMinim <= referinta) continue;

                const isMajor = intervalRank >= INTERVAL_PRIORITY.get('1d');
                const priority = -Math.abs(centru - referinta) / referinta +
                    intervalRank * 0.0005 +
                    Math.min(atingeri, 8) * 0.0001;
                candidates[categorie].push({
                    id: randomUUID(),
                    categorie,
                    tip_forma: isMajor ? 'line' : 'box',
                    pret_minim: isMajor ? centru : pretMinim,
                    pret_maxim: isMajor ? centru : pretMaxim,
                    zone_minim_usd: pretMinim,
                    zone_maxim_usd: pretMaxim,
                    center: centru,
                    interval,
                    intervalRank,
                    atingeri,
                    priority,
                    culoare,
                    denumire
                });
            }
        }
    }

    const desene = [];
    for (const categorie of ['support', 'resistance']) {
        for (const zona of selectPriorityZones(candidates[categorie], referinta)) {
            const isMajor = zona.tip_forma === 'line';
            const intervalTexto = `${zona.denumire} ${zona.interval}`;
            const eticheta = isMajor
                ? `${intervalTexto} major · zona ${formatPrice(zona.zone_minim_usd)}–${formatPrice(zona.zone_maxim_usd)} USD · linie ${formatPrice(zona.center)} USD · ${zona.atingeri} ${zona.atingeri === 1 ? 'atingere' : 'atingeri'}`
                : `${intervalTexto} · ${formatPrice(zona.pret_minim)}–${formatPrice(zona.pret_maxim)} USD · ${zona.atingeri} ${zona.atingeri === 1 ? 'atingere' : 'atingeri'}`;
            const coordonate = isMajor
                ? { x1: 0, y1_usd: zona.center, x2: 1, y2_usd: zona.center }
                : {
                    x1: 0,
                    x2: 1,
                    pret_minim_usd: zona.pret_minim,
                    pret_maxim_usd: zona.pret_maxim
                };
            const desen = addDrawingMetadata({
                id: zona.id,
                tip_forma: zona.tip_forma,
                categoria: isMajor ? `${categorie}_major` : categorie,
                tip: categorie,
                interval: zona.interval,
                pret_minim: zona.pret_minim,
                pret_maxim: zona.pret_maxim,
                pret_referinta: referinta,
                zone_minim_usd: zona.zone_minim_usd,
                zone_maxim_usd: zona.zone_maxim_usd,
                coordonate,
                eticheta,
                atingeri_pivot: zona.atingeri,
                animat: false
            }, zona.culoare);
            desene.push(desen, createLevelCallout(desen));
        }
    }

    const extreme = niveluriTehnice.extreme_istorice || datePiață.date_fundamentale_si_macro?.extreme_istorice || {};
    const deseneExtreme = [
        { extreme: extreme.atl, eticheta: 'ATL', categorie: 'support_major', culoare: SUPPORT_COLOR },
        { extreme: extreme.ath, eticheta: 'ATH', categorie: 'resistance_major', culoare: ATH_COLOR }
    ];

    for (const { extreme: valoare, eticheta, categorie, culoare } of deseneExtreme) {
        const pret = toPositiveNumber(valoare?.pret_usd);
        if (pret === null) continue;

        const desen = addDrawingMetadata({
            id: randomUUID(),
            tip_forma: 'line',
            categoria: categorie,
            tip: categorie === 'support_major' ? 'support' : 'resistance',
            interval: 'all-time',
            pret_minim: pret,
            pret_maxim: pret,
            pret_referinta: referinta,
            coordonate: { x1: 0, y1_usd: pret, x2: 1, y2_usd: pret },
            eticheta: `${eticheta} · ${formatPrice(pret)} USD`,
            animat: false
        }, culoare);
        desene.push(desen, createLevelCallout(desen));
    }

    return desene;
};

const genereazaDeseneScenarii = (scenarii, tipForma = 'vector') => {
    if (tipForma !== 'vector' && tipForma !== 'arrow') {
        throw new TypeError('tipForma trebuie să fie "vector" sau "arrow".');
    }

    const desene = [];

    for (const scenariu of [scenarii?.long, scenarii?.short]) {
        if (!scenariu || !['long', 'short'].includes(scenariu.direction) ||
            !Number.isFinite(scenariu.entry_usd) ||
            !Number.isFinite(scenariu.stop_loss_usd) ||
            !Number.isFinite(scenariu.take_profit_usd) ||
            !Number.isFinite(scenariu.risk_reward)) {
            continue;
        }

        const direction = scenariu.direction;
        const risk = direction === 'long'
            ? scenariu.entry_usd - scenariu.stop_loss_usd
            : scenariu.stop_loss_usd - scenariu.entry_usd;
        const reward = direction === 'long'
            ? scenariu.take_profit_usd - scenariu.entry_usd
            : scenariu.entry_usd - scenariu.take_profit_usd;
        const riskReward = reward / risk;
        if (risk <= 0 || reward <= 0 || !Number.isFinite(riskReward) || riskReward < 3) continue;

        const directionLabel = direction === 'long' ? 'LONG' : 'SHORT';
        const color = direction === 'long' ? TARGET_COLOR : RESISTANCE_COLOR;
        const riskRewardLabel = `Target R/R 1:${formatRiskReward(riskReward)}`;

        desene.push(addDrawingMetadata({
            id: randomUUID(),
            tip_forma: tipForma,
            categoria: `scenario_${direction}`,
            interval: 'scenario',
            pret_minim: Math.min(scenariu.entry_usd, scenariu.stop_loss_usd, scenariu.take_profit_usd),
            pret_maxim: Math.max(scenariu.entry_usd, scenariu.stop_loss_usd, scenariu.take_profit_usd),
            entry_usd: scenariu.entry_usd,
            stop_loss_usd: scenariu.stop_loss_usd,
            take_profit_usd: scenariu.take_profit_usd,
            coordonate: {
                x_scale: 'scenario_progress',
                x1: 0,
                y1_usd: scenariu.entry_usd,
                x2: 1,
                y2_usd: scenariu.take_profit_usd,
                stop_x: 0,
                stop_y_usd: scenariu.stop_loss_usd
            },
            eticheta: `${directionLabel} · scenariu condițional · ${formatPrice(scenariu.entry_usd)} → ${formatPrice(scenariu.take_profit_usd)} USD`,
            animat: false
        }, color));

        for (const [role, price, label, badgeColor, x] of [
            ['entry', scenariu.entry_usd, `Entry ${formatPrice(scenariu.entry_usd)} USD`, ENTRY_COLOR, 0],
            ['stop', scenariu.stop_loss_usd, `Stop ${formatPrice(scenariu.stop_loss_usd)} USD`, STOP_COLOR, 0],
            ['target', scenariu.take_profit_usd, `${riskRewardLabel} · ${formatPrice(scenariu.take_profit_usd)} USD`, TARGET_COLOR, 1]
        ]) {
            desene.push(addDrawingMetadata({
                id: randomUUID(),
                tip_forma: 'callout_badge',
                categoria: `scenario_${direction}_${role}`,
                interval: 'scenario',
                pret_minim: price,
                pret_maxim: price,
                coordonate: { x, y_usd: price },
                eticheta: `${directionLabel} · ${label}`,
                animat: false
            }, badgeColor));
        }
    }

    return desene;
};

const genereazaDeseneStructuriSMC = (structuriSMC = {}) => {
    const desene = [];
    const intervale = structuriSMC.intervals || {};

    for (const [interval, structuri] of Object.entries(intervale)) {
        for (const fvg of structuri.fair_value_gaps || []) {
            const color = fvg.direction === 'bullish' ? BULLISH_FVG_COLOR : BEARISH_FVG_COLOR;
            desene.push(addDrawingMetadata({
                id: randomUUID(),
                tip_forma: 'box',
                categoria: `fvg_${fvg.direction}`,
                tip: 'FVG',
                interval,
                pret_minim: fvg.zone_minim_usd,
                pret_maxim: fvg.zone_maxim_usd,
                zone_minim_usd: fvg.zone_minim_usd,
                zone_maxim_usd: fvg.zone_maxim_usd,
                timp_start_utc: fvg.start_time_utc,
                timp_detectie_utc: fvg.detection_time_utc,
                timp_start_ms: fvg.start_time_ms,
                timp_detectie_ms: fvg.detection_time_ms,
                status: fvg.status,
                coordonate: {
                    x1: fvg.start_time_ms,
                    x2: fvg.detection_time_ms,
                    x1_timp_utc: fvg.start_time_utc,
                    x2_timp_utc: fvg.detection_time_utc,
                    pret_minim_usd: fvg.zone_minim_usd,
                    pret_maxim_usd: fvg.zone_maxim_usd
                },
                eticheta: `[FVG ${interval} ${fvg.direction}] ${formatPrice(fvg.zone_minim_usd)}–${formatPrice(fvg.zone_maxim_usd)} USD`,
                animat: false
            }, color));
        }

        for (const sweep of structuri.liquidity_sweeps || []) {
            const highSweep = sweep.direction === 'high';
            desene.push(addDrawingMetadata({
                id: randomUUID(),
                tip_forma: 'callout_badge',
                categoria: `liquidity_sweep_${sweep.direction}`,
                tip: 'liquidity_sweep',
                interval,
                pret_minim: sweep.wick_extreme_usd,
                pret_maxim: sweep.wick_extreme_usd,
                swept_level_usd: sweep.swept_level_usd,
                candle_close_usd: sweep.candle_close_usd,
                timp_detectie_utc: sweep.detection_time_utc,
                timp_detectie_ms: sweep.detection_time_ms,
                coordonate: {
                    x: sweep.candle_time_ms,
                    x_timp_utc: sweep.candle_time_utc,
                    y_usd: sweep.wick_extreme_usd,
                    swept_level_usd: sweep.swept_level_usd
                },
                eticheta: `[Liquidity Sweep ${interval}] ${highSweep ? 'high' : 'low'} ${formatPrice(sweep.swept_level_usd)} USD · reclaim close ${formatPrice(sweep.candle_close_usd)} USD`,
                animat: false
            }, SWEEP_COLOR));
        }

        for (const orderBlock of structuri.order_blocks || []) {
            const color = orderBlock.direction === 'bullish' ? BULLISH_OB_COLOR : BEARISH_OB_COLOR;
            desene.push(addDrawingMetadata({
                id: randomUUID(),
                tip_forma: 'box',
                categoria: `order_block_${orderBlock.direction}`,
                tip: 'OB',
                interval,
                pret_minim: orderBlock.zone_minim_usd,
                pret_maxim: orderBlock.zone_maxim_usd,
                zone_minim_usd: orderBlock.zone_minim_usd,
                zone_maxim_usd: orderBlock.zone_maxim_usd,
                broken_swing_usd: orderBlock.broken_swing_usd,
                break_type: orderBlock.break_type,
                timp_start_utc: orderBlock.origin_time_utc,
                timp_detectie_utc: orderBlock.detection_time_utc,
                timp_start_ms: orderBlock.origin_time_ms,
                timp_detectie_ms: orderBlock.detection_time_ms,
                displacement_body_to_average: orderBlock.displacement_body_to_average,
                coordonate: {
                    x1: orderBlock.origin_time_ms,
                    x2: orderBlock.detection_time_ms,
                    x1_timp_utc: orderBlock.origin_time_utc,
                    x2_timp_utc: orderBlock.detection_time_utc,
                    pret_minim_usd: orderBlock.zone_minim_usd,
                    pret_maxim_usd: orderBlock.zone_maxim_usd
                },
                eticheta: `[OB ${interval} ${orderBlock.direction} · BOS proxy] ${formatPrice(orderBlock.zone_minim_usd)}–${formatPrice(orderBlock.zone_maxim_usd)} USD`,
                animat: false
            }, color));
        }
    }

    return desene;
};

const genereazaScenariiCalificate = (drawings, reference, minimumRiskReward = 3) => {
    const requiredRiskReward = Number.isFinite(minimumRiskReward)
        ? Math.max(3, minimumRiskReward)
        : 3;
    if (!Number.isFinite(reference) || reference <= 0) {
        return { long: null, short: null, minimum_risk_reward: requiredRiskReward };
    }

    const safeDrawings = Array.isArray(drawings) ? drawings : [];
    const supports = safeDrawings.filter(drawing => drawing?.categoria?.startsWith('support'));
    const resistances = safeDrawings.filter(drawing => drawing?.categoria?.startsWith('resistance'));
    const priceFor = (drawing, side) => {
        if (drawing.tip_forma === 'line') return toPositiveNumber(drawing.pret_minim);
        return toPositiveNumber(side === 'lower' ? drawing.zone_minim_usd : drawing.zone_maxim_usd);
    };
    const candidates = [];

    for (const support of supports) {
        const stop = priceFor(support, 'lower');
        const risk = reference - stop;
        if (stop === null || risk <= 0) continue;

        for (const resistance of resistances) {
            const target = priceFor(resistance, 'lower');
            if (target === null) continue;
            const reward = target - reference;
            const riskReward = reward / risk;
            if (reward <= 0 || !Number.isFinite(riskReward) || riskReward < requiredRiskReward) continue;
            candidates.push({
                direction: 'long',
                entry_usd: reference,
                stop_loss_usd: stop,
                stop_level: support.eticheta,
                take_profit_usd: target,
                target_level: resistance.eticheta,
                risk_usd: risk,
                reward_usd: reward,
                risk_reward: Number(riskReward.toFixed(4)),
                invalidation_condition: `prețul coboară sub ${formatPrice(stop)} USD, sub limita suportului ${support.eticheta}`
            });
        }
    }

    for (const resistance of resistances) {
        const stop = priceFor(resistance, 'upper');
        const risk = stop - reference;
        if (stop === null || risk <= 0) continue;

        for (const support of supports) {
            const target = priceFor(support, 'upper');
            if (target === null) continue;
            const reward = reference - target;
            const riskReward = reward / risk;
            if (reward <= 0 || !Number.isFinite(riskReward) || riskReward < requiredRiskReward) continue;
            candidates.push({
                direction: 'short',
                entry_usd: reference,
                stop_loss_usd: stop,
                stop_level: resistance.eticheta,
                take_profit_usd: target,
                target_level: support.eticheta,
                risk_usd: risk,
                reward_usd: reward,
                risk_reward: Number(riskReward.toFixed(4)),
                invalidation_condition: `prețul urcă peste ${formatPrice(stop)} USD, peste limita rezistenței ${resistance.eticheta}`
            });
        }
    }

    const select = (direction) => candidates
        .filter(candidate => candidate.direction === direction)
        .sort((first, second) =>
            Math.abs(first.take_profit_usd - reference) - Math.abs(second.take_profit_usd - reference) ||
            second.risk_reward - first.risk_reward
        )[0] || null;

    return {
        long: select('long'),
        short: select('short'),
        minimum_risk_reward: requiredRiskReward
    };
};

module.exports = {
    genereazaElementeGrafice,
    genereazaScenariiCalificate,
    genereazaDeseneScenarii,
    genereazaDeseneStructuriSMC
};
