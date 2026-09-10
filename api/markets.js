export default async function handler(req, res) {
  try {
    const url =
      "https://external-api.kalshi.com/trade-api/v2/markets?limit=100&status=open";

    const response = await fetch(url);

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Kalshi request failed",
        status: response.status,
      });
    }

    const data = await response.json();

    return res.status(200).json({
      success: true,
      marketCount: data.markets?.length || 0,
      cursor: data.cursor || null,
      markets: data.markets || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
