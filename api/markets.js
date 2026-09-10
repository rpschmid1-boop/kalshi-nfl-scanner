export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=1000"
    );

    if (!response.ok) {
      throw new Error(`Kalshi returned ${response.status}`);
    }

    const data = await response.json();
    const markets = data.markets || [];

    const sampleMarkets = markets.slice(0, 50).map((m) => ({
      ticker: m.ticker,
      eventTicker: m.event_ticker,
      title: m.title,
      subtitle: m.subtitle,
      yesSubtitle: m.yes_sub_title,
      noSubtitle: m.no_sub_title,
      yesBid: m.yes_bid_dollars,
      yesAsk: m.yes_ask_dollars,
      noBid: m.no_bid_dollars,
      noAsk: m.no_ask_dollars,
      volume: m.volume_fp,
      closeTime: m.close_time,
    }));

    const tickerMatches = markets
      .filter((m) => {
        const ticker = (m.ticker || "").toUpperCase();
        const eventTicker = (m.event_ticker || "").toUpperCase();

        return (
          ticker.includes("NFL") ||
          eventTicker.includes("NFL")
        );
      })
      .slice(0, 100)
      .map((m) => ({
        ticker: m.ticker,
        eventTicker: m.event_ticker,
        title: m.title,
        subtitle: m.subtitle,
        yesSubtitle: m.yes_sub_title,
        noSubtitle: m.no_sub_title,
        yesBid: m.yes_bid_dollars,
        yesAsk: m.yes_ask_dollars,
        noBid: m.no_bid_dollars,
        noAsk: m.no_ask_dollars,
        volume: m.volume_fp,
        closeTime: m.close_time,
      }));

    return res.status(200).json({
      success: true,
      marketsInFirstPage: markets.length,
      hasMorePages: Boolean(data.cursor),
      nflTickerMatches: tickerMatches.length,
      tickerMatches,
      sampleMarkets,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}