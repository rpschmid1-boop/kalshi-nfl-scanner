export default async function handler(req, res) {
  try {
    const baseUrl =
      "https://api.elections.kalshi.com/trade-api/v2/markets";

    let allMarkets = [];
    let cursor = null;
    let pages = 0;

    // Pull all currently open markets
    do {
      const url = new URL(baseUrl);

      url.searchParams.set("status", "open");
      url.searchParams.set("limit", "1000");

      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`Kalshi returned ${response.status}`);
      }

      const data = await response.json();

      allMarkets.push(...(data.markets || []));

      cursor = data.cursor || null;
      pages++;

      // Safety valve so a bug doesn't loop forever
      if (pages >= 20) break;
    } while (cursor);

    const nflMarkets = allMarkets
      .filter((m) => {
        const text = [
          m.ticker,
          m.event_ticker,
          m.title,
          m.subtitle,
          m.yes_sub_title,
          m.no_sub_title,
        ]
          .filter(Boolean)
          .join(" ")
          .toUpperCase();

        /*
         * First-pass NFL filter.
         *
         * We deliberately exclude obvious college football.
         * We'll tighten this once we see Kalshi's actual NFL
         * ticker structure in the returned results.
         */
        const looksNFL =
          text.includes("NFL") ||
          text.includes("PRO FOOTBALL");

        const looksCollege =
          text.includes("COLLEGE") ||
          text.includes("NCAA") ||
          text.includes("CFB");

        return looksNFL && !looksCollege;
      })
      .map((m) => ({
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
      .sort((a, b) => {
        const aVolume = Number(a.volume24h || 0);
        const bVolume = Number(b.volume24h || 0);

        return bVolume - aVolume;
      });

    return res.status(200).json({
      success: true,
      pagesFetched: pages,
      totalOpenMarkets: allMarkets.length,
      nflMarketCount: nflMarkets.length,
      nflMarkets,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}