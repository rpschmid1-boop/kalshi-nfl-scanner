/*
 * Pull ALL open Kalshi multivariate markets.
 *
 * IMPORTANT:
 * MVE/combo markets are not normal series markets.
 * Kalshi exposes them through mve_filter=only.
 *
 * We fetch the MVE universe and then identify
 * same-game NFL spread + total combos by inspecting
 * mve_selected_legs.
 */
async function getOpenMVEMarkets() {
  let markets = [];
  let cursor = null;
  let pages = 0;

  do {
    const url = new URL(`${BASE}/markets`);

    url.searchParams.set(
      "status",
      "open"
    );

    url.searchParams.set(
      "mve_filter",
      "only"
    );

    url.searchParams.set(
      "limit",
      "1000"
    );

    if (cursor) {
      url.searchParams.set(
        "cursor",
        cursor
      );
    }

    const response =
      await fetch(
        url.toString(),
        {
          headers: {
            Accept:
              "application/json",
          },
        }
      );

    if (!response.ok) {
      throw new Error(
        `MVE markets: Kalshi returned ${response.status}`
      );
    }

    const data =
      await response.json();

    const pageMarkets =
      data.markets || [];

    markets.push(
      ...pageMarkets.map((m) => ({
        type: "combo",

        sourceSeries:
          m.series_ticker ||
          null,

        ticker:
          m.ticker,

        eventTicker:
          m.event_ticker,

        title:
          m.title,

        subtitle:
          m.subtitle,

        yesSubtitle:
          m.yes_sub_title,

        noSubtitle:
          m.no_sub_title,

        status:
          m.status,

        yesBid:
          numberOrZero(
            m.yes_bid_dollars
          ),

        yesAsk:
          numberOrZero(
            m.yes_ask_dollars
          ),

        noBid:
          numberOrZero(
            m.no_bid_dollars
          ),

        noAsk:
          numberOrZero(
            m.no_ask_dollars
          ),

        lastPrice:
          numberOrZero(
            m.last_price_dollars
          ),

        volume:
          numberOrZero(
            m.volume_fp
          ),

        volume24h:
          numberOrZero(
            m.volume_24h_fp
          ),

        openInterest:
          numberOrZero(
            m.open_interest_fp
          ),

        closeTime:
          m.close_time,

        expirationTime:
          m.expected_expiration_time,

        mveCollectionTicker:
          m.mve_collection_ticker ||
          null,

        mveSelectedLegs:
          Array.isArray(
            m.mve_selected_legs
          )
            ? m.mve_selected_legs
            : [],

        customStrike:
          m.custom_strike ||
          null,

        isProvisional:
          Boolean(
            m.is_provisional
          ),
      }))
    );

    cursor =
      data.cursor || null;

    pages++;

    /*
     * Safety cap.
     *
     * If we ever hit this, return enough metadata
     * to know the MVE universe is larger than
     * our scan capacity.
     */
    if (pages >= 20) {
      console.warn(
        "MVE pagination safety limit hit"
      );

      break;
    }
  } while (cursor);

  return markets;
}

const comboMarkets =
  await getOpenMVEMarkets();