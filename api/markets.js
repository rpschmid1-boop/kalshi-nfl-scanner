export default async function handler(req, res) {
  try {
    const BASE =
      "https://api.elections.kalshi.com/trade-api/v2/markets";

    const series = [
      { ticker: "KXNFLGAME", type: "moneyline" },
      { ticker: "KXNFLSPREAD", type: "spread" },
      { ticker: "KXNFLTOTAL", type: "total" },
    ];

    /*
     * Pull every open market for one NFL series.
     */
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
            expirationTime: m.expected_expiration_time,
          }))
        );

        cursor = data.cursor || null;
        pages++;

        // Safety valve
        if (pages >= 10) break;
      } while (cursor);

      return markets;
    }

    /*
     * Midpoint of current YES bid/ask.
     *
     * Used to identify the strike closest to a 50/50 market.
     */
    function getMidpoint(market) {
      if (market.yesBid > 0 && market.yesAsk > 0) {
        return (market.yesBid + market.yesAsk) / 2;
      }

      if (market.lastPrice > 0) {
        return market.lastPrice;
      }

      return null;
    }

    /*
     * Select the contract closest to 50%.
     *
     * If two strikes are equally close to 50%, prefer:
     * 1. Higher 24-hour volume
     * 2. Tighter bid/ask spread
     */
    function selectMainMarket(markets) {
      const valid = markets
        .map((m) => {
          const midpoint = getMidpoint(m);

          const bidAskSpread =
            m.yesAsk > 0 && m.yesBid > 0
              ? m.yesAsk - m.yesBid
              : 999;

          return {
            ...m,
            midpoint,
            distanceFrom50:
              midpoint !== null
                ? Math.abs(midpoint - 0.5)
                : 999,
            bidAskSpread,
          };
        })
        .filter(
          (m) =>
            m.midpoint !== null &&
            m.yesAsk > 0 &&
            m.yesAsk < 1
        )
        .sort((a, b) => {
          if (a.distanceFrom50 !== b.distanceFrom50) {
            return a.distanceFrom50 - b.distanceFrom50;
          }

          if (a.volume24h !== b.volume24h) {
            return b.volume24h - a.volume24h;
          }

          return a.bidAskSpread - b.bidAskSpread;
        });

      return valid[0] || null;
    }

    /*
     * Extract a number such as:
     *
     * "Over 47.5 points scored" -> 47.5
     * "Los Angeles R wins by over 3.5 points" -> 3.5
     */
    function extractNumber(text) {
      if (!text) return null;

      const match = text.match(
        /(?:over|under)\s+(-?\d+(?:\.\d+)?)/i
      );

      if (!match) return null;

      return Number(match[1]);
    }

    /*
     * Clean up a market so the endpoint doesn't
     * return unnecessary Kalshi fields.
     */
    function cleanMarket(market) {
      if (!market) return null;

      return {
        ticker: market.ticker,
        outcome: market.yesSubtitle || market.title,

        line: extractNumber(
          market.yesSubtitle || market.title
        ),

        yesBid: market.yesBid,
        yesAsk: market.yesAsk,

        noBid: market.noBid,
        noAsk: market.noAsk,

        midpoint:
          market.midpoint !== undefined
            ? Number(market.midpoint.toFixed(4))
            : getMidpoint(market),

        last: market.lastPrice,

        volume24h: market.volume24h,
        openInterest: market.openInterest,
      };
    }

    /*
     * Fetch all three NFL market families in parallel.
     */
    const results = await Promise.all(
      series.map((s) =>
        getSeriesMarkets(s.ticker, s.type)
      )
    );

    const allMarkets = results.flat();

    /*
     * Group GAME / SPREAD / TOTAL contracts
     * under the same game ID.
     */
    const games = {};

    for (const m of allMarkets) {
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

      /*
       * Use earliest close time we see for the game.
       */
      if (
        m.closeTime &&
        (!game.closeTime ||
          new Date(m.closeTime) <
            new Date(game.closeTime))
      ) {
        game.closeTime = m.closeTime;
      }

      if (m.type === "moneyline") {
        game.moneyline.push(m);
      }

      if (m.type === "spread") {
        game.spreads.push(m);
      }

      if (m.type === "total") {
        game.totals.push(m);
      }
    }

    /*
     * Produce compact game objects.
     */
    const cleanGames = Object.values(games)
      .map((game) => {
        const mainSpread =
          selectMainMarket(game.spreads);

        const mainTotal =
          selectMainMarket(game.totals);

        const moneyline = game.moneyline
          .filter(
            (m) =>
              m.yesAsk > 0 &&
              m.yesAsk < 1
          )
          .map((m) => ({
            ticker: m.ticker,

            team:
              m.yesSubtitle ||
              m.subtitle ||
              m.title,

            bid: m.yesBid,
            ask: m.yesAsk,

            midpoint:
              getMidpoint(m) !== null
                ? Number(
                    getMidpoint(m).toFixed(4)
                  )
                : null,

            last: m.lastPrice,

            volume24h: m.volume24h,
            openInterest: m.openInterest,
          }));

        return {
          gameId: game.gameId,
          game: game.title,
          closeTime: game.closeTime,

          moneyline,

          mainSpread: cleanMarket(mainSpread),

          mainTotal: cleanMarket(mainTotal),

          marketCounts: {
            moneyline: game.moneyline.length,
            spreads: game.spreads.length,
            totals: game.totals.length,
          },
        };
      })

      /*
       * Only keep games with actual moneyline markets.
       */
      .filter((game) => game.moneyline.length > 0)

      /*
       * Upcoming games first.
       */
      .sort(
        (a, b) =>
          new Date(a.closeTime) -
          new Date(b.closeTime)
      );

    /*
     * Optional query:
     *
     * /api/markets?raw=true
     *
     * lets us inspect the full ladders again
     * if we ever need to debug.
     */
    if (req.query.raw === "true") {
      return res.status(200).json({
        success: true,
        mode: "raw",

        counts: {
          games: cleanGames.length,
          markets: allMarkets.length,
        },

        games: Object.values(games),
      });
    }

    return res.status(200).json({
      success: true,
      updatedAt: new Date().toISOString(),

      gameCount: cleanGames.length,

      games: cleanGames,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}