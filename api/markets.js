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

        markets.push(
          ...(data.markets || []).map((m) => ({
            type,
            ticker: m.ticker,
            eventTicker: m.event_ticker,
            title: m.title,
            subtitle: m.subtitle,
            yesSubtitle: m.yes_sub_title,
            noSubtitle: m.no_sub_title,
            status: m.status,

            yesBid: Number(m.yes_bid_dollars || 0),
            yesAsk: Number(m.yes_ask_dollars || 0),
            noBid: Number(m.no_bid_dollars || 0),
            noAsk: Number(m.no_ask_dollars || 0),

            lastPrice: Number(m.last_price_dollars || 0),

            volume: Number(m.volume_fp || 0),
            volume24h: Number(m.volume_24h_fp || 0),
            openInterest: Number(m.open_interest_fp || 0),

            closeTime: m.close_time,
          }))
        );

        cursor = data.cursor || null;
        pages++;

        if (pages >= 10) break;
      } while (cursor);

      return markets;
    }

    const results = await Promise.all(
      series.map((s) => getSeriesMarkets(s.ticker, s.type))
    );

    const allMarkets = results.flat();

    const games = {};

    for (const m of allMarkets) {
      /*
       * Strip the contract-specific suffix and keep
       * the underlying game identifier.
       *
       * Examples:
       * KXNFLGAME-26SEP10SFLAR-SF
       * KXNFLSPREAD-26SEP10SFLAR-SF7
       * KXNFLTOTAL-26SEP10SFLAR-45
       *
       * all map to:
       * 26SEP10SFLAR
       */

      const match = m.eventTicker?.match(
        /^KXNFL(?:GAME|SPREAD|TOTAL)-(.+)$/
      );

      if (!match) continue;

      const gameId = match[1];

      if (!games[gameId]) {
        games[gameId] = {
          gameId,
          title: null,
          closeTime: m.closeTime,
          moneyline: [],
          spreads: [],
          totals: [],
        };
      }

      const game = games[gameId];

      if (!game.title && m.title) {
        game.title = m.title;
      }

      if (m.type === "moneyline") {
        game.moneyline.push({
          ticker: m.ticker,
          team: m.yesSubtitle,
          bid: m.yesBid,
          ask: m.yesAsk,
          last: m.lastPrice,
          volume24h: m.volume24h,
        });
      }

      if (m.type === "spread") {
        game.spreads.push({
          ticker: m.ticker,
          outcome: m.yesSubtitle,
          bid: m.yesBid,
          ask: m.yesAsk,
          last: m.lastPrice,
          volume24h: m.volume24h,
        });
      }

      if (m.type === "total") {
        game.totals.push({
          ticker: m.ticker,
          outcome: m.yesSubtitle,
          bid: m.yesBid,
          ask: m.yesAsk,
          last: m.lastPrice,
          volume24h: m.volume24h,
        });
      }
    }

    const groupedGames = Object.values(games)
      .sort((a, b) => {
        return new Date(a.closeTime) - new Date(b.closeTime);
      });

    return res.status(200).json({
      success: true,
      gameCount: groupedGames.length,
      games: groupedGames,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}