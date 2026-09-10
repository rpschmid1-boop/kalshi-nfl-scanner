export default async function handler(req, res) {
  try {
    const base =
      "https://external-api.kalshi.com/trade-api/v2/markets?limit=1000&status=open";

    const response = await fetch(base);

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: "Kalshi request failed",
        status: response.status,
      });
    }

    const data = await response.json();

    const markets = data.markets || [];

    const nfl = markets
      .filter((m) => {
        const text = [
          m.title,
          m.subtitle,
          m.event_ticker,
          m.series_ticker,
          m.ticker,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return (
          text.includes("nfl") ||
          text.includes("falcons") ||
          text.includes("steelers") ||
          text.includes("patriots") ||
          text.includes("seahawks") ||
          text.includes("ravens") ||
          text.includes("colts") ||
          text.includes("lions") ||
          text.includes("saints")
        );
      })
      .map((m) => ({
        ticker: m.ticker,
        title: m.title,
        subtitle: m.subtitle,
        eventTicker: m.event_ticker,
        seriesTicker: m.series_ticker,

        yesBid: m.yes_bid,
        yesAsk: m.yes_ask,
        noBid: m.no_bid,
        noAsk: m.no_ask,

        lastPrice: m.last_price,
        volume: m.volume,
        openInterest: m.open_interest,

        closeTime: m.close_time,
        status: m.status,
      }));

    return res.status(200).json({
      success: true,
      totalOpenMarkets: markets.length,
      nflMarketCount: nfl.length,
      nfl,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}