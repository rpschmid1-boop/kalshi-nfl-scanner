export default async function handler(req, res) {
  try {
    const BASE =
      "https://api.elections.kalshi.com/trade-api/v2/markets";

    const series = [
      { ticker: "KXNFLGAME", type: "moneyline" },
      { ticker: "KXNFLSPREAD", type: "spread" },
      { ticker: "KXNFLTOTAL", type: "total" },
    ];

    async function getSeriesMarkets(seriesTicker, type) {
      let markets = [];
      let cursor = null;
      let pages = 0;

      do {
        const url = new URL(BASE);

        url.searchParams.set("series_ticker", seriesTicker);
        url.searchParams.set("status", "open");
        url.searchParams.set("limit", "1000");

        if (cursor) {
          url.searchParams.set("cursor", cursor);
        }

        const response = await fetch(url.toString());

        if (!response.ok) {
          throw new Error(
            `${seriesTicker}: Kalshi returned ${response.status}`
          );
        }

        const data = await response.json();

        const returnedMarkets = data.markets || [];

        markets.push(
          ...returnedMarkets.map((m) => ({
            type,

            ticker: m.ticker,
            eventTicker: m.event_ticker,

            title: m.title,
            subtitle: m.subtitle,

            yesSubtitle: m.yes_sub_title,
            noSubtitle: m.no_sub_title,

            status: m.status,

            yesBid: m.yes_bid_dollars,
            yesAsk: m.yes_ask_dollars,

            noBid: m.no_bid_dollars,
            noAsk: m.no_ask_dollars,

            lastPrice: m.last_price_dollars,

            volume: m.volume_fp,
            volume24h: m.volume_24h_fp,
            openInterest: m.open_interest_fp,
            liquidity: m.liquidity_dollars,

            openTime: m.open_time,
            closeTime: m.close_time,
            expirationTime: m.expected_expiration_time,
          }))
        );

        cursor = data.cursor || null;
        pages++;

        if (pages >= 10) break;
      } while (cursor);

      return {
        seriesTicker,
        type,
        pages,
        count: markets.length,
        markets,
      };
    }

    // Fetch ML, spreads and totals simultaneously
    const results = await Promise.all(
      series.map((s) => getSeriesMarkets(s.ticker, s.type))
    );

    const allMarkets = results.flatMap((r) => r.markets);

    // Sort by closing time so upcoming games appear first
    allMarkets.sort((a, b) => {
      return new Date(a.closeTime) - new Date(b.closeTime);
    });

    return res.status(200).json({
      success: true,

      counts: {
        moneyline:
          results.find((r) => r.type === "moneyline")?.count || 0,

        spread:
          results.find((r) => r.type === "spread")?.count || 0,

        total:
          results.find((r) => r.type === "total")?.count || 0,

        all: allMarkets.length,
      },

      markets: allMarkets,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}