const axios = require('axios');

const ASSET_DIRECTORY_TTL_MS = 6 * 60 * 60 * 1000;
let assetDirectoryCache = null;
let assetDirectoryFetchedAt = 0;
let assetDirectoryRequest = null;
const coincapIdCache = new Map();

const normalizeAssetKey = value => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const MAJOR_ASSETS = [
    { coingecko: 'bitcoin', coincap: 'bitcoin', symbol: 'BTC', binance: 'BTCUSDT', aliases: ['btc', 'bitcoin'] },
    { coingecko: 'ethereum', coincap: 'ethereum', symbol: 'ETH', binance: 'ETHUSDT', aliases: ['eth', 'ethereum'] },
    { coingecko: 'solana', coincap: 'solana', symbol: 'SOL', binance: 'SOLUSDT', aliases: ['sol', 'solana'] },
    { coingecko: 'bittensor', coincap: 'bittensor', symbol: 'TAO', binance: 'TAOUSDT', aliases: ['tao', 'bittensor'] },
    { coingecko: 'cardano', coincap: 'cardano', symbol: 'ADA', binance: 'ADAUSDT', aliases: ['ada', 'cardano'] },
    { coingecko: 'ripple', coincap: 'xrp', symbol: 'XRP', binance: 'XRPUSDT', aliases: ['xrp', 'ripple'] },
    { coingecko: 'polkadot', coincap: 'polkadot', symbol: 'DOT', binance: 'DOTUSDT', aliases: ['dot', 'polkadot'] },
    { coingecko: 'dogecoin', coincap: 'dogecoin', symbol: 'DOGE', binance: 'DOGEUSDT', aliases: ['doge', 'dogecoin'] },
    { coingecko: 'avalanche-2', coincap: 'avalanche', symbol: 'AVAX', binance: 'AVAXUSDT', aliases: ['avax', 'avalanche'] },
    { coingecko: 'chainlink', coincap: 'chainlink', symbol: 'LINK', binance: 'LINKUSDT', aliases: ['link', 'chainlink'] },
    { coingecko: 'litecoin', coincap: 'litecoin', symbol: 'LTC', binance: 'LTCUSDT', aliases: ['ltc', 'litecoin'] },
    { coingecko: 'bitcoin-cash', coincap: 'bitcoin-cash', symbol: 'BCH', binance: 'BCHUSDT', aliases: ['bch', 'bitcoin cash'] },
    { coingecko: 'tron', coincap: 'tron', symbol: 'TRX', binance: 'TRXUSDT', aliases: ['trx', 'tron'] },
    { coingecko: 'stellar', coincap: 'stellar', symbol: 'XLM', binance: 'XLMUSDT', aliases: ['xlm', 'stellar'] },
    { coingecko: 'the-open-network', coincap: 'toncoin', symbol: 'TON', binance: 'TONUSDT', aliases: ['ton', 'toncoin', 'the open network'] },
    { coingecko: 'sui', coincap: 'sui', symbol: 'SUI', binance: 'SUIUSDT', aliases: ['sui'] },
    { coingecko: 'shiba-inu', coincap: 'shiba-inu', symbol: 'SHIB', binance: 'SHIBUSDT', aliases: ['shib', 'shiba inu'] },
    { coingecko: 'uniswap', coincap: 'uniswap', symbol: 'UNI', binance: 'UNIUSDT', aliases: ['uni', 'uniswap'] },
    { coingecko: 'cosmos', coincap: 'cosmos', symbol: 'ATOM', binance: 'ATOMUSDT', aliases: ['atom', 'cosmos'] },
    { coingecko: 'near', coincap: 'near', symbol: 'NEAR', binance: 'NEARUSDT', aliases: ['near', 'near protocol'] },
    { coingecko: 'aptos', coincap: 'aptos', symbol: 'APT', binance: 'APTUSDT', aliases: ['apt', 'aptos'] },
    { coingecko: 'arbitrum', coincap: 'arbitrum', symbol: 'ARB', binance: 'ARBUSDT', aliases: ['arb', 'arbitrum'] },
    { coingecko: 'optimism', coincap: 'optimism', symbol: 'OP', binance: 'OPUSDT', aliases: ['op', 'optimism'] },
    { coingecko: 'polygon-ecosystem-token', coincap: 'polygon', symbol: 'POL', binance: 'POLUSDT', aliases: ['pol', 'polygon'] }
];
const MAJOR_ASSET_ALIASES = new Map(
    MAJOR_ASSETS.flatMap(asset => asset.aliases.map(alias => [normalizeAssetKey(alias), asset]))
);

const parseBinanceCandles = (rows, now = Date.now()) => (Array.isArray(rows) ? rows : [])
    .map(row => ({
        open_time: Number(row?.[0]),
        open: Number(row?.[1]),
        high: Number(row?.[2]),
        low: Number(row?.[3]),
        close: Number(row?.[4]),
        volume: Number(row?.[5]),
        close_time: Number(row?.[6])
    }))
    .filter(candle =>
        Number.isFinite(candle.open_time) &&
        Number.isFinite(candle.close_time) &&
        candle.close_time <= now &&
        [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) &&
        candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0 && candle.volume >= 0 &&
        candle.high >= Math.max(candle.open, candle.close, candle.low) &&
        candle.low <= Math.min(candle.open, candle.close, candle.high)
    );

const fetchBinanceCandles = async (symbol, interval, limit, warn = () => {}) => {
    const encodedSymbol = encodeURIComponent(symbol);
    const encodedInterval = encodeURIComponent(interval);
    const safeLimit = Math.min(1000, Math.max(1, Math.floor(Number(limit) || 0)));
    try {
        const response = await axios.get(
            `https://api.binance.com/api/v3/klines?symbol=${encodedSymbol}&interval=${encodedInterval}&limit=${safeLimit}`,
            { timeout: 3000 }
        );
        if (!Array.isArray(response.data)) {
            throw new Error('Binance returned a non-array candle response.');
        }
        return parseBinanceCandles(response.data);
    } catch (error) {
        warn(`Binance candles ${interval}`, error.message);
        return [];
    }
};

const fetchAssetDirectory = async (warn = () => {}) => {
    if (assetDirectoryCache && Date.now() - assetDirectoryFetchedAt < ASSET_DIRECTORY_TTL_MS) {
        return assetDirectoryCache;
    }
    if (assetDirectoryRequest) return assetDirectoryRequest;

    assetDirectoryRequest = (async () => {
        const fetchOptional = async (url, source) => {
            try {
                const response = await axios.get(url, { timeout: 8000 });
                return response.data;
            } catch (error) {
                warn(source, error.message);
                return null;
            }
        };
        const [coinGeckoCoins, binanceInfo] = await Promise.all([
            fetchOptional('https://api.coingecko.com/api/v3/coins/list?include_platform=false', 'CoinGecko asset directory'),
            fetchOptional('https://api.binance.com/api/v3/exchangeInfo', 'Binance trading pairs')
        ]);

        const binancePairs = new Map();
        for (const pair of Array.isArray(binanceInfo?.symbols) ? binanceInfo.symbols : []) {
            if (pair.status !== 'TRADING' || !['USDT', 'USDC', 'FDUSD'].includes(pair.quoteAsset)) continue;
            const existing = binancePairs.get(pair.baseAsset);
            if (!existing || pair.quoteAsset === 'USDT') {
                binancePairs.set(pair.baseAsset, pair.symbol);
            }
        }

        const directory = {
            coins: Array.isArray(coinGeckoCoins) ? coinGeckoCoins : [],
            binancePairs
        };
        if (directory.coins.length || binancePairs.size) {
            assetDirectoryCache = directory;
            assetDirectoryFetchedAt = Date.now();
        }
        return directory;
    })().finally(() => {
        assetDirectoryRequest = null;
    });

    return assetDirectoryRequest;
};

const resolveCoinConfiguration = async (input, warn = () => {}) => {
    const normalizedInput = normalizeAssetKey(input);
    const mappedAsset = MAJOR_ASSET_ALIASES.get(normalizedInput);
    if (mappedAsset) {
        return {
            coingecko: mappedAsset.coingecko,
            coincap: mappedAsset.coincap,
            binance: mappedAsset.binance,
            symbol: mappedAsset.symbol
        };
    }

    const directory = await fetchAssetDirectory(warn);
    const exactId = directory.coins.find(coin => normalizeAssetKey(coin.id) === normalizedInput);
    const exactSymbolMatches = directory.coins.filter(coin => normalizeAssetKey(coin.symbol) === normalizedInput);
    const exactNameMatches = directory.coins.filter(coin => normalizeAssetKey(coin.name) === normalizedInput);
    const candidates = exactId ? [exactId] : exactSymbolMatches.length ? exactSymbolMatches : exactNameMatches;
    if (!exactId && exactSymbolMatches.length > 1) {
        const exchangeMatches = exactSymbolMatches.filter(coin =>
            directory.binancePairs.has(String(coin.symbol).toUpperCase())
        );
        if (exchangeMatches.length > 1) {
            const names = exchangeMatches.slice(0, 5).map(coin => `${coin.name} (${coin.id})`).join(', ');
            const error = new Error(`Simbol ambiguu "${input}". Specifică numele complet sau ID-ul CoinGecko dintre: ${names}.`);
            error.status = 400;
            throw error;
        }
    }

    if (!candidates.length) {
        const symbol = String(input).trim().toUpperCase();
        const binance = directory.binancePairs.get(symbol);
        if (!binance) {
            throw new Error(`Moneda "${input}" nu a fost găsită în catalogul CoinGecko sau în perechile Binance disponibile.`);
        }
        let coincap = await resolveCoinCapId({ id: null, name: null, symbol }, warn);
        return { coingecko: null, coincap, binance, symbol };
    }

    const selectedCoin = candidates.find(coin => directory.binancePairs.has(String(coin.symbol).toUpperCase())) || candidates[0];
    const symbol = String(selectedCoin.symbol || '').toUpperCase();
    const binance = directory.binancePairs.get(symbol) || `${symbol}USDT`;
    const coincap = await resolveCoinCapId(selectedCoin, warn);

    return {
        coingecko: selectedCoin.id,
        coincap,
        binance,
        symbol
    };
};

const resolveCoinCapId = async (coin, warn = () => {}) => {
    const cacheKey = coin.id || `${coin.symbol}:${coin.name || ''}`;
    const cached = coincapIdCache.get(cacheKey);
    if (cached) return cached;

    const queries = [...new Set([coin.id, coin.symbol, coin.name].filter(Boolean))];
    for (const query of queries) {
        try {
            const response = await axios.get(
                `https://api.coincap.io/v2/assets?search=${encodeURIComponent(query)}&limit=100`,
                { timeout: 5000 }
            );
            const assets = Array.isArray(response.data?.data) ? response.data.data : [];
            const match = assets.find(asset =>
                normalizeAssetKey(asset.symbol) === normalizeAssetKey(coin.symbol) &&
                coin.name &&
                normalizeAssetKey(asset.name) === normalizeAssetKey(coin.name)
            ) || assets.find(asset =>
                normalizeAssetKey(asset.symbol) === normalizeAssetKey(coin.symbol) &&
                coin.id &&
                normalizeAssetKey(asset.id) === normalizeAssetKey(coin.id)
            ) || assets.find(asset =>
                normalizeAssetKey(asset.symbol) === normalizeAssetKey(coin.symbol)
            );
            if (match?.id) {
                coincapIdCache.set(cacheKey, match.id);
                return match.id;
            }
        } catch (error) {
            warn('CoinCap asset directory', error.message);
        }
    }

    const fallback = coin.id || normalizeAssetKey(coin.symbol);
    coincapIdCache.set(cacheKey, fallback);
    return fallback;
};

const aggregatePriceObservations = (observations) => {
    const valid = (Array.isArray(observations) ? observations : [])
        .filter(observation => Number.isFinite(observation.price) && observation.price > 0)
        .map(observation => ({ source: observation.source, price: observation.price }))
        .sort((first, second) => first.price - second.price);
    const middle = Math.floor(valid.length / 2);
    const median = valid.length === 0
        ? null
        : valid.length % 2 === 1
            ? valid[middle].price
            : (valid[middle - 1].price + valid[middle].price) / 2;

    return {
        median,
        count: valid.length,
        minimum: valid.length ? valid[0].price : null,
        maximum: valid.length ? valid[valid.length - 1].price : null,
        spreadPercent: median === null
            ? null
            : Number(((valid[valid.length - 1].price - valid[0].price) / median * 100).toFixed(4)),
        maxDeviationPercent: median === null
            ? null
            : Math.max(...valid.map(observation => Math.abs(observation.price - median) / median * 100)),
        observations: valid.map(observation => ({
            source: observation.source,
            price_usd: observation.price,
            deviation_from_median_percent: median === null
                ? null
                : Number(((observation.price - median) / median * 100).toFixed(4))
        }))
    };
};

const decodeXml = (value) => value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");

const readTag = (xml, tag) => {
    const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
    return match ? decodeXml(match[1].trim()) : '';
};

const cleanNewsText = (value, limit) => decodeXml(String(value || ''))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);

const parseRssNews = (xml) => {
    if (typeof xml !== 'string') return [];

    return [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
        .map(([, , item]) => {
            const linkTag = item.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
            const link = readTag(item, 'link') || linkTag?.[1] || '';
            return {
                titlu: cleanNewsText(readTag(item, 'title'), 300),
                sumar: cleanNewsText(
                    readTag(item, 'description') || readTag(item, 'summary') || readTag(item, 'content'),
                    500
                ),
                url: decodeXml(link),
                publicat_utc: readTag(item, 'pubDate') || readTag(item, 'published') || readTag(item, 'updated') || null,
                sursa: 'CoinDesk RSS'
            };
        })
        .filter(stire => stire.titlu && stire.url);
};

const normalizeCoinGeckoUpdates = (updates) => (Array.isArray(updates) ? updates : [])
    .filter(update => update && typeof update === 'object')
    .map(update => ({
        titlu: cleanNewsText(update.title || update.project?.name, 300),
        sumar: cleanNewsText(update.description, 500),
        url: update.url || '',
        publicat_utc: update.created_at || null,
        sursa: update.project?.name || 'CoinGecko'
    }))
    .filter(stire => stire.titlu);

const fetchFundamentalData = async ({
    coinId,
    coinName,
    symbol,
    coingeckoId,
    binanceSymbol,
    binanceTicker,
    warn = () => {}
}) => {
    const fetchOptional = async (url, source, options = {}) => {
        try {
            const response = await axios.get(url, { timeout: 3000, ...options });
            return response.data;
        } catch (error) {
            warn(source, error.message);
            return null;
        }
    };

    const encodedCoinId = encodeURIComponent(coingeckoId);
    const encodedBinanceSymbol = encodeURIComponent(binanceSymbol);
    const hasCoinGeckoId = typeof coingeckoId === 'string' && coingeckoId.length > 0;
    const [coinData, coinUpdates, fearGreedData, rssData, bookTicker] = await Promise.all([
        hasCoinGeckoId
            ? fetchOptional(
                `https://api.coingecko.com/api/v3/coins/${encodedCoinId}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false&sparkline=false`,
                'CoinGecko fundamentals'
            )
            : Promise.resolve(null),
        hasCoinGeckoId
            ? fetchOptional(
                `https://api.coingecko.com/api/v3/coins/${encodedCoinId}/status_updates?per_page=5`,
                'CoinGecko updates'
            )
            : Promise.resolve(null),
        fetchOptional('https://api.alternative.me/fng/?limit=1&format=json', 'Fear & Greed Index'),
        fetchOptional('https://www.coindesk.com/arc/outboundfeeds/rss/', 'CoinDesk RSS', { responseType: 'text' }),
        fetchOptional(
            `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${encodedBinanceSymbol}`,
            'Binance order book'
        )
    ]);

    const numberOrNull = value => {
        const number = Number(value);
        return value != null && Number.isFinite(number) ? number : null;
    };
    const bidPrice = numberOrNull(bookTicker?.bidPrice);
    const askPrice = numberOrNull(bookTicker?.askPrice);
    const bidQuantity = numberOrNull(bookTicker?.bidQty);
    const askQuantity = numberOrNull(bookTicker?.askQty);
    const spreadUsd = bidPrice !== null && askPrice !== null ? askPrice - bidPrice : null;
    const spreadPercent = spreadUsd !== null && bidPrice > 0
        ? (spreadUsd / ((bidPrice + askPrice) / 2)) * 100
        : null;
    const fearGreed = fearGreedData?.data?.[0];
    const marketData = coinData?.market_data;
    const updates = normalizeCoinGeckoUpdates(coinUpdates?.status_updates);
    const escapedTerms = [symbol, coinName, coinId]
        .filter(Boolean)
        .map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .map(term => new RegExp(`\\b${term}\\b`, 'i'));
    const matchingRss = parseRssNews(rssData)
        .filter(article => escapedTerms.some(term => term.test(`${article.titlu} ${article.sumar}`)));
    const news = [...updates, ...matchingRss]
        .filter((article, index, articles) =>
            articles.findIndex(candidate => candidate.titlu === article.titlu) === index
        )
        .slice(0, 5);

    const sentimentUp = numberOrNull(
        coinData?.sentiment_votes_up_percentage ?? marketData?.sentiment_votes_up_percentage
    );
    const sentimentDown = numberOrNull(
        coinData?.sentiment_votes_down_percentage ?? marketData?.sentiment_votes_down_percentage
    );
    const sentimentLabel = sentimentUp !== null && sentimentDown !== null
        ? sentimentUp > sentimentDown ? 'predominant pozitiv' : sentimentDown > sentimentUp ? 'predominant negativ' : 'echilibrat'
        : null;
    const fearGreedDate = new Date(Number(fearGreed?.timestamp) * 1000);
    const fearGreedUpdatedAt = Number.isFinite(fearGreedDate.getTime())
        ? fearGreedDate.toISOString()
        : null;
    const binanceQuoteVolume = bidTickerVolume(binanceTicker);
    const quoteCurrency = binanceSymbol.match(/(?:USDT|USDC|BUSD|FDUSD)$/)?.[0] || null;
    const sourceStatus = [
        { provider: 'CoinGecko', category: 'fundamentals/community', available: Boolean(coinData), price_source: false },
        { provider: 'Alternative.me', category: 'market sentiment', available: Boolean(fearGreed), price_source: false },
        { provider: 'CoinDesk', category: 'news', available: typeof rssData === 'string' && rssData.length > 0, price_source: false },
        { provider: 'Binance', category: 'order book', available: Boolean(bookTicker), price_source: false }
    ];

    return {
        surse_date: sourceStatus,
        sentiment_macro: fearGreed ? {
            indice: numberOrNull(fearGreed.value),
            clasificare: fearGreed.value_classification || null,
            actualizat_utc: fearGreedUpdatedAt,
            sursa: 'Alternative.me'
        } : null,
        volum_24h: {
            valoare: quoteCurrency && binanceQuoteVolume !== null
                ? binanceQuoteVolume
                : numberOrNull(marketData?.total_volume?.usd),
            unitate: quoteCurrency && binanceQuoteVolume !== null ? quoteCurrency : 'USD',
            sursa: quoteCurrency && binanceQuoteVolume !== null
                ? `Binance (quote volume ${quoteCurrency})`
                : marketData?.total_volume?.usd != null ? 'CoinGecko' : null,
            volum_moneda_binance: numberOrNull(binanceTicker?.volume),
            volum_cotat_binance: numberOrNull(binanceTicker?.quoteVolume)
        },
        lichiditate: {
            market_cap_usd: numberOrNull(marketData?.market_cap?.usd),
            rang_market_cap: numberOrNull(marketData?.market_cap_rank),
            oferta_circulanta: numberOrNull(marketData?.circulating_supply),
            bid_usd: bidPrice,
            ask_usd: askPrice,
            spread_usd: spreadUsd,
            spread_procent: spreadPercent,
            adancime_top_bid_usd: bidPrice !== null && bidQuantity !== null ? bidPrice * bidQuantity : null,
            adancime_top_ask_usd: askPrice !== null && askQuantity !== null ? askPrice * askQuantity : null,
            sursa_order_book: bookTicker ? 'Binance bookTicker (cel mai bun nivel)' : null
        },
        sentiment_moneda: {
            voturi_pozitive_procent: sentimentUp,
            voturi_negative_procent: sentimentDown,
            interpretare: sentimentLabel,
            sursa: sentimentUp !== null || sentimentDown !== null ? 'CoinGecko community data' : null
        },
        extreme_istorice: {
            ath: marketData?.ath?.usd != null ? {
                pret_usd: numberOrNull(marketData.ath.usd),
                data_utc: marketData.ath_date || null,
                sursa: 'CoinGecko'
            } : null,
            atl: marketData?.atl?.usd != null ? {
                pret_usd: numberOrNull(marketData.atl.usd),
                data_utc: marketData.atl_date || null,
                sursa: 'CoinGecko'
            } : null
        },
        stiri_recente: news,
        stiri_status: news.length
            ? 'Actualizări și articole recente disponibile; relevanța coin-specifică este filtrată după simbol/nume.'
            : 'Nu au fost găsite știri coin-specifice în sursele publice disponibile; sentimentul comunității este furnizat separat când există.'
    };
};

const bidTickerVolume = (ticker) => {
    const volume = Number(ticker?.quoteVolume);
    return Number.isFinite(volume) && volume > 0 ? volume : null;
};

module.exports = {
    aggregatePriceObservations,
    fetchBinanceCandles,
    fetchFundamentalData,
    parseBinanceCandles,
    resolveCoinConfiguration
};
