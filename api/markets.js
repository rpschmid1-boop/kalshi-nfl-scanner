export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://api.elections.kalshi.com/trade-api/v2/markets?limit=1000"
    );

    if (!response.ok) {
      throw new Error(`Kalshi returned ${response.status}`);
    }

    const data = await response.json();
    const markets = data.markets || [];

    const sample = markets.slice(0, 50).map((m) => ({
      ticker: m.ticker,
      eventTicker: m.event_ticker,
      title: m.title,
      subtitle: m.subtitle,
    }));

    return res.status(200).json({
      success: true,
      fetched: markets.length,
      sample,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}