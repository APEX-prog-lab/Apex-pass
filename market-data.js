const axios = require('axios');

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
    const [coinData, coinUpdates, fearGreedData, rssData, bookTicker] = await Promise.all([
        fetchOptional(
            `https://api.coingecko.com/api/v3/coins/${encodedCoinId}?localization=false&tickers=false&market_data=true&community_data=true&developer_data=false&sparkline=false`,
            'CoinGecko fundamentals'
        ),
        fetchOptional(
            `https://api.coingecko.com/api/v3/coins/${encodedCoinId}/status_updates?per_page=5`,
            'CoinGecko updates'
        ),
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

    return {
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

module.exports = { fetchFundamentalData };
