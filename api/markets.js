export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://external-api.kalshi.com/trade-api/v2/markets?limit=1000&status=open"
    );

    if (!response.ok) {
      throw new Error(`Kalshi returned ${response.status}`);
    }

    const data = await response.json();
    const markets = data.markets || [];

    const nfl = markets
      .filter((m) => {
        const fields = [
          m.ticker,
          m.event_ticker,
          m.series_ticker
        ].filter(Boolean);

        return fields.some((x) =>
          x.toUpperCase().startsWith("KXNFL")
        );
      })
      .map((m) => ({
        ticker: m.ticker,
        eventTicker: m.event_ticker,
        seriesTicker: m.series_ticker,

        title: m.title,
        subtitle: m.subtitle,

        yesBid: m.yes_bid,
        yesAsk: m.yes_ask,
        noBid: m.no_bid,
        noAsk: m.no_ask,

        yesBidDollars: m.yes_bid_dollars,
        yesAskDollars: m.yes_ask_dollars,
        noBidDollars: m.no_bid_dollars,
        noAskDollars: m.no_ask_dollars,

        lastPrice: m.last_price,

        volume: m.volume,
        liquidity: m.liquidity_dollars,

        closeTime: m.close_time,
        status: m.status
      }));

    return res.status(200).json({
      success: true,
      fetched: markets.length,
      nflMarketCount: nfl.length,
      nfl
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}