export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://api.elections.kalshi.com/trade-api/v2/series?category=Sports"
    );

    if (!response.ok) {
      throw new Error(`Kalshi returned ${response.status}`);
    }

    const data = await response.json();
    const series = data.series || [];

    const football = series
      .filter((s) => {
        const text = [
          s.ticker,
          s.title,
          s.category,
          ...(s.tags || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toUpperCase();

        return (
          text.includes("NFL") ||
          text.includes("FOOTBALL")
        );
      })
      .map((s) => ({
        ticker: s.ticker,
        title: s.title,
        category: s.category,
        tags: s.tags,
        frequency: s.frequency,
      }));

    return res.status(200).json({
      success: true,
      totalSeries: series.length,
      footballCount: football.length,
      football,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}