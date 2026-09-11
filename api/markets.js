export default async function handler(req, res) {
  try {
    const BASE =
      "https://api.elections.kalshi.com/trade-api/v2";

    const standardSeries = [
      { ticker: "KXNFLGAME", type: "moneyline" },
      { ticker: "KXNFLSPREAD", type: "spread" },
      { ticker: "KXNFLTOTAL", type: "total" },
    ];

    /*
     * Optional query parameters:
     *
     * /api/markets
     *
     * /api/markets?gameId=26SEP13CHICAR
     *
     * /api/markets?gameId=26SEP13CHICAR&depth=true
     *
     * /api/markets?raw=true
     */
    const requestedGameId = req.query.gameId
      ? String(req.query.gameId).toUpperCase()
      : null;

    const includeDepth =
      req.query.depth === "true";

    const rawMode =
      req.query.raw === "true";

    const depthLevels = Math.min(
      20,
      Math.max(
        1,
        Number(req.query.depthLevels || 5)
      )
    );

    function numberOrZero(value) {
      const number = Number(value);

      return Number.isFinite(number)
        ? number
        : 0;
    }

    /*
     * Normalize Kalshi market object.
     */
    function normalizeMarket(
      market,
      type = null
    ) {
      return {
        type,

        ticker:
          market.ticker,

        eventTicker:
          market.event_ticker,

        title:
          market.title,

        subtitle:
          market.subtitle,

        yesSubtitle:
          market.yes_sub_title,

        noSubtitle:
          market.no_sub_title,

        status:
          market.status,

        yesBid:
          numberOrZero(
            market.yes_bid_dollars
          ),

        yesAsk:
          numberOrZero(
            market.yes_ask_dollars
          ),

        noBid:
          numberOrZero(
            market.no_bid_dollars
          ),

        noAsk:
          numberOrZero(
            market.no_ask_dollars
          ),

        lastPrice:
          numberOrZero(
            market.last_price_dollars
          ),

        volume:
          numberOrZero(
            market.volume_fp
          ),

        volume24h:
          numberOrZero(
            market.volume_24h_fp
          ),

        openInterest:
          numberOrZero(
            market.open_interest_fp
          ),

        liquidity:
          numberOrZero(
            market.liquidity_dollars
          ),

        closeTime:
          market.close_time,

        expirationTime:
          market.expected_expiration_time,

        /*
         * Multivariate / combo metadata.
         */
        mveCollectionTicker:
          market.mve_collection_ticker ||
          null,

        mveSelectedLegs:
          Array.isArray(
            market.mve_selected_legs
          )
            ? market.mve_selected_legs
            : [],

        customStrike:
          market.custom_strike ||
          null,

        isProvisional:
          Boolean(
            market.is_provisional
          ),
      };
    }

    /*
     * Pull all open markets from a normal
     * Kalshi series.
     */
    async function getSeriesMarkets(
      seriesTicker,
      type
    ) {
      let markets = [];
      let cursor = null;
      let pages = 0;

      do {
        const url =
          new URL(`${BASE}/markets`);

        url.searchParams.set(
          "series_ticker",
          seriesTicker
        );

        url.searchParams.set(
          "status",
          "open"
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
            `${seriesTicker}: Kalshi returned ${response.status}`
          );
        }

        const data =
          await response.json();

        const pageMarkets =
          data.markets || [];

        markets.push(
          ...pageMarkets.map(
            (market) =>
              normalizeMarket(
                market,
                type
              )
          )
        );

        cursor =
          data.cursor || null;

        pages++;

        /*
         * Safety valve.
         */
        if (pages >= 10) {
          console.warn(
            `${seriesTicker}: pagination safety limit reached`
          );

          break;
        }
      } while (cursor);

      return markets;
    }

    /*
     * Pull open multivariate markets.
     *
     * This is the IMPORTANT change.
     *
     * Kalshi documents:
     *
     * mve_filter=only
     *
     * as the proper way to retrieve
     * multivariate / combo markets.
     */
    async function getMVEMarkets(
      minCloseTs = null,
      maxCloseTs = null
    ) {
      let markets = [];
      let cursor = null;
      let pages = 0;
      let truncated = false;

      do {
        const url =
          new URL(`${BASE}/markets`);

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

        /*
         * Restrict the scan to the
         * relevant NFL date window.
         *
         * This avoids downloading every
         * open combo across every sport.
         */
        if (minCloseTs) {
          url.searchParams.set(
            "min_close_ts",
            String(minCloseTs)
          );
        }

        if (maxCloseTs) {
          url.searchParams.set(
            "max_close_ts",
            String(maxCloseTs)
          );
        }

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
          ...pageMarkets.map(
            (market) =>
              normalizeMarket(
                market,
                "combo"
              )
          )
        );

        cursor =
          data.cursor || null;

        pages++;

        /*
         * MVE universe can get large.
         */
        if (pages >= 20) {
          if (cursor) {
            truncated = true;
          }

          break;
        }
      } while (cursor);

      /*
       * Deduplicate by ticker.
       */
      const uniqueMarkets =
        Array.from(
          new Map(
            markets.map(
              (market) => [
                market.ticker,
                market,
              ]
            )
          ).values()
        );

      return {
        markets:
          uniqueMarkets,

        pages,

        truncated,
      };
    }

    function getMidpoint(
      market
    ) {
      if (
        market.yesBid > 0 &&
        market.yesAsk > 0
      ) {
        return (
          market.yesBid +
          market.yesAsk
        ) / 2;
      }

      if (
        market.lastPrice > 0
      ) {
        return market.lastPrice;
      }

      return null;
    }

    /*
     * Pick strike closest to a
     * 50/50 market.
     */
    function selectMainMarket(
      markets
    ) {
      const valid =
        markets
          .map((market) => {
            const midpoint =
              getMidpoint(
                market
              );

            const bidAskSpread =
              market.yesAsk > 0 &&
              market.yesBid > 0
                ? market.yesAsk -
                  market.yesBid
                : 999;

            return {
              ...market,

              midpoint,

              distanceFrom50:
                midpoint !== null
                  ? Math.abs(
                      midpoint -
                      0.5
                    )
                  : 999,

              bidAskSpread,
            };
          })
          .filter(
            (market) =>
              market.midpoint !==
                null &&
              market.yesAsk > 0 &&
              market.yesAsk < 1
          )
          .sort((a, b) => {
            if (
              a.distanceFrom50 !==
              b.distanceFrom50
            ) {
              return (
                a.distanceFrom50 -
                b.distanceFrom50
              );
            }

            if (
              a.volume24h !==
              b.volume24h
            ) {
              return (
                b.volume24h -
                a.volume24h
              );
            }

            return (
              a.bidAskSpread -
              b.bidAskSpread
            );
          });

      return valid[0] || null;
    }

    function extractNumber(
      text
    ) {
      if (!text) {
        return null;
      }

      const match =
        text.match(
          /(?:over|under)\s+(-?\d+(?:\.\d+)?)/i
        );

      return match
        ? Number(match[1])
        : null;
    }

    /*
     * Event:
     *
     * KXNFLSPREAD-26SEP13CHICAR
     *
     * becomes:
     *
     * 26SEP13CHICAR
     */
    function extractNFLGameId(
      eventTicker
    ) {
      if (!eventTicker) {
        return null;
      }

      const match =
        eventTicker.match(
          /^KXNFL(?:GAME|SPREAD|TOTAL)-(.+)$/
        );

      return match
        ? match[1]
        : null;
    }

    function getLegType(
      eventTicker
    ) {
      if (
        eventTicker?.startsWith(
          "KXNFLSPREAD-"
        )
      ) {
        return "spread";
      }

      if (
        eventTicker?.startsWith(
          "KXNFLTOTAL-"
        )
      ) {
        return "total";
      }

      if (
        eventTicker?.startsWith(
          "KXNFLGAME-"
        )
      ) {
        return "moneyline";
      }

      return "other";
    }

    function cleanMarket(
      market
    ) {
      if (!market) {
        return null;
      }

      return {
        ticker:
          market.ticker,

        eventTicker:
          market.eventTicker,

        outcome:
          market.yesSubtitle ||
          market.title,

        line:
          extractNumber(
            market.yesSubtitle ||
            market.title
          ),

        yesBid:
          market.yesBid,

        yesAsk:
          market.yesAsk,

        noBid:
          market.noBid,

        noAsk:
          market.noAsk,

        midpoint:
          market.midpoint !==
          undefined
            ? Number(
                market.midpoint.toFixed(
                  4
                )
              )
            : getMidpoint(
                market
              ),

        last:
          market.lastPrice,

        volume24h:
          market.volume24h,

        openInterest:
          market.openInterest,

        liquidity:
          market.liquidity,
      };
    }

    /*
     * STEP 1:
     *
     * Fetch ordinary NFL markets.
     */
    const standardResults =
      await Promise.all(
        standardSeries.map(
          (series) =>
            getSeriesMarkets(
              series.ticker,
              series.type
            )
        )
      );

    const standardMarkets =
      standardResults.flat();

    const underlyingByTicker =
      new Map(
        standardMarkets.map(
          (market) => [
            market.ticker,
            market,
          ]
        )
      );

    /*
     * STEP 2:
     *
     * Group standard markets by NFL game.
     */
    const games = {};

    for (
      const market of
        standardMarkets
    ) {
      const gameId =
        extractNFLGameId(
          market.eventTicker
        );

      if (!gameId) {
        continue;
      }

      if (!games[gameId]) {
        games[gameId] = {
          gameId,

          title: null,

          closeTime:
            market.closeTime,

          moneyline: [],

          spreads: [],

          totals: [],
        };
      }

      const game =
        games[gameId];

      if (
        !game.title &&
        market.title
      ) {
        game.title =
          market.title;
      }

      if (
        market.closeTime &&
        (!game.closeTime ||
          new Date(
            market.closeTime
          ) <
            new Date(
              game.closeTime
            ))
      ) {
        game.closeTime =
          market.closeTime;
      }

      if (
        market.type ===
        "moneyline"
      ) {
        game.moneyline.push(
          market
        );
      }

      if (
        market.type ===
        "spread"
      ) {
        game.spreads.push(
          market
        );
      }

      if (
        market.type ===
        "total"
      ) {
        game.totals.push(
          market
        );
      }
    }

    /*
     * Determine which games we're
     * scanning.
     */
    let targetGameObjects =
      Object.values(games);

    if (requestedGameId) {
      targetGameObjects =
        targetGameObjects.filter(
          (game) =>
            game.gameId ===
            requestedGameId
        );
    }

    /*
     * Build a date window for MVE scan.
     *
     * Four days on either side gives
     * plenty of breathing room while
     * avoiding every open combo on Kalshi.
     */
    const validCloseTimes =
      targetGameObjects
        .map(
          (game) =>
            new Date(
              game.closeTime
            ).getTime()
        )
        .filter(
          (time) =>
            Number.isFinite(time)
        );

    let minCloseTs = null;
    let maxCloseTs = null;

    if (
      validCloseTimes.length > 0
    ) {
      const FOUR_DAYS =
        4 *
        24 *
        60 *
        60 *
        1000;

      const minTime =
        Math.min(
          ...validCloseTimes
        ) - FOUR_DAYS;

      const maxTime =
        Math.max(
          ...validCloseTimes
        ) + FOUR_DAYS;

      minCloseTs =
        Math.floor(
          minTime / 1000
        );

      maxCloseTs =
        Math.ceil(
          maxTime / 1000
        );
    }

    /*
     * STEP 3:
     *
     * Fetch MVE / combo universe.
     */
    const mveResult =
      await getMVEMarkets(
        minCloseTs,
        maxCloseTs
      );

    const comboMarkets =
      mveResult.markets;

    /*
     * STEP 4:
     *
     * Analyze MVE legs.
     *
     * We ONLY want:
     *
     * - exactly two legs
     * - one NFL spread
     * - one NFL total
     * - both from same game
     */
    function analyzeCombo(
      market
    ) {
      const legs =
        market.mveSelectedLegs ||
        [];

      if (
        legs.length !== 2
      ) {
        return null;
      }

      const normalizedLegs =
        legs.map((leg) => {
          const underlying =
            underlyingByTicker.get(
              leg.market_ticker
            );

          /*
           * Prefer event ticker supplied
           * by the MVE leg.
           *
           * Fall back to underlying
           * market if necessary.
           */
          const eventTicker =
            leg.event_ticker ||
            underlying?.eventTicker ||
            null;

          const type =
            getLegType(
              eventTicker
            );

          const side =
            String(
              leg.side || ""
            ).toLowerCase();

          let outcome = null;

          if (underlying) {
            if (
              side === "yes"
            ) {
              outcome =
                underlying.yesSubtitle ||
                underlying.title;
            } else if (
              side === "no"
            ) {
              /*
               * Kalshi NO subtitles are
               * not always human-readable,
               * so keep the exact YES
               * proposition and label it NO.
               */
              outcome =
                `NO: ${
                  underlying.yesSubtitle ||
                  underlying.title
                }`;
            }
          }

          return {
            type,

            eventTicker,

            marketTicker:
              leg.market_ticker,

            side,

            outcome,

            gameId:
              extractNFLGameId(
                eventTicker
              ),

            yesSettlementValue:
              leg.yes_settlement_value_dollars ||
              null,
          };
        });

      const spreadLeg =
        normalizedLegs.find(
          (leg) =>
            leg.type ===
            "spread"
        );

      const totalLeg =
        normalizedLegs.find(
          (leg) =>
            leg.type ===
            "total"
        );

      if (
        !spreadLeg ||
        !totalLeg
      ) {
        return null;
      }

      /*
       * Must be same NFL game.
       */
      if (
        !spreadLeg.gameId ||
        spreadLeg.gameId !==
          totalLeg.gameId
      ) {
        return null;
      }

      return {
        gameId:
          spreadLeg.gameId,

        ticker:
          market.ticker,

        eventTicker:
          market.eventTicker,

        collectionTicker:
          market.mveCollectionTicker,

        title:
          market.title,

        subtitle:
          market.subtitle,

        spread: {
          ticker:
            spreadLeg.marketTicker,

          side:
            spreadLeg.side,

          outcome:
            spreadLeg.outcome,
        },

        total: {
          ticker:
            totalLeg.marketTicker,

          side:
            totalLeg.side,

          outcome:
            totalLeg.outcome,
        },

        quadrantKey:
          `spread_${spreadLeg.side}__total_${totalLeg.side}`,

        yesBid:
          market.yesBid,

        yesAsk:
          market.yesAsk,

        noBid:
          market.noBid,

        noAsk:
          market.noAsk,

        midpoint:
          getMidpoint(
            market
          ),

        last:
          market.lastPrice,

        volume24h:
          market.volume24h,

        openInterest:
          market.openInterest,

        liquidity:
          market.liquidity,

        executable:
          market.yesAsk > 0 &&
          market.yesAsk < 1,

        isProvisional:
          market.isProvisional,
      };
    }

    const analyzedCombos =
      comboMarkets
        .map(analyzeCombo)
        .filter(Boolean);

    /*
     * Group combos by NFL game.
     */
    const combosByGame = {};

    for (
      const combo of
        analyzedCombos
    ) {
      if (
        !combosByGame[
          combo.gameId
        ]
      ) {
        combosByGame[
          combo.gameId
        ] = [];
      }

      combosByGame[
        combo.gameId
      ].push(combo);
    }

    function matchesMainMarkets(
      combo,
      mainSpread,
      mainTotal
    ) {
      if (
        !mainSpread ||
        !mainTotal
      ) {
        return false;
      }

      return (
        combo.spread.ticker ===
          mainSpread.ticker &&
        combo.total.ticker ===
          mainTotal.ticker
      );
    }

    /*
     * STEP 5:
     *
     * Build final game objects.
     */
    let cleanGames =
      Object.values(games)
        .map((game) => {
          const mainSpread =
            selectMainMarket(
              game.spreads
            );

          const mainTotal =
            selectMainMarket(
              game.totals
            );

          const moneyline =
            game.moneyline
              .filter(
                (market) =>
                  market.yesAsk > 0 &&
                  market.yesAsk < 1
              )
              .map(
                (market) => ({
                  ticker:
                    market.ticker,

                  team:
                    market.yesSubtitle ||
                    market.subtitle ||
                    market.title,

                  bid:
                    market.yesBid,

                  ask:
                    market.yesAsk,

                  midpoint:
                    getMidpoint(
                      market
                    ) !== null
                      ? Number(
                          getMidpoint(
                            market
                          ).toFixed(
                            4
                          )
                        )
                      : null,

                  last:
                    market.lastPrice,

                  volume24h:
                    market.volume24h,

                  openInterest:
                    market.openInterest,
                })
              );

          const gameCombos =
            (
              combosByGame[
                game.gameId
              ] || []
            ).sort(
              (a, b) => {
                /*
                 * Executable markets first.
                 */
                if (
                  a.executable !==
                  b.executable
                ) {
                  return a.executable
                    ? -1
                    : 1;
                }

                return (
                  b.volume24h -
                  a.volume24h
                );
              }
            );

          /*
           * Exact combo using the
           * scanner's main spread +
           * main total.
           */
          const mainLineCombos =
            gameCombos.filter(
              (combo) =>
                matchesMainMarkets(
                  combo,
                  mainSpread,
                  mainTotal
                )
            );

          /*
           * Expected possible keys:
           *
           * spread_yes__total_yes
           * spread_yes__total_no
           * spread_no__total_yes
           * spread_no__total_no
           */
          const quadrantMap = {};

          for (
            const combo of
              mainLineCombos
          ) {
            quadrantMap[
              combo.quadrantKey
            ] = combo;
          }

          return {
            gameId:
              game.gameId,

            game:
              game.title,

            closeTime:
              game.closeTime,

            moneyline,

            mainSpread:
              cleanMarket(
                mainSpread
              ),

            mainTotal:
              cleanMarket(
                mainTotal
              ),

            combos: {
              totalSameGameSpreadTotal:
                gameCombos.length,

              mainLineComboCount:
                mainLineCombos.length,

              mainLineUnderlying:
                mainSpread &&
                mainTotal
                  ? {
                      spreadTicker:
                        mainSpread.ticker,

                      totalTicker:
                        mainTotal.ticker,
                    }
                  : null,

              quadrants:
                quadrantMap,

              mainLineMarkets:
                mainLineCombos,

              /*
               * Keep some other combos
               * available so we can optimize
               * nearby lines too.
               */
              otherLineMarkets:
                gameCombos
                  .filter(
                    (combo) =>
                      !matchesMainMarkets(
                        combo,
                        mainSpread,
                        mainTotal
                      )
                  )
                  .slice(
                    0,
                    50
                  ),
            },

            marketCounts: {
              moneyline:
                game.moneyline.length,

              spreads:
                game.spreads.length,

              totals:
                game.totals.length,

              combos:
                gameCombos.length,
            },
          };
        })
        .filter(
          (game) =>
            game.moneyline.length >
            0
        )
        .sort(
          (a, b) =>
            new Date(
              a.closeTime
            ) -
            new Date(
              b.closeTime
            )
        );

    if (requestedGameId) {
      cleanGames =
        cleanGames.filter(
          (game) =>
            game.gameId ===
            requestedGameId
        );
    }

    /*
     * Optional combo order-book depth.
     */
    async function getOrderbook(
      ticker
    ) {
      const url =
        new URL(
          `${BASE}/markets/${encodeURIComponent(
            ticker
          )}/orderbook`
        );

      url.searchParams.set(
        "depth",
        String(depthLevels)
      );

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
        return {
          success: false,

          status:
            response.status,
        };
      }

      const data =
        await response.json();

      const book =
        data.orderbook_fp ||
        data.orderbook ||
        {};

      const yesBids =
        (
          book.yes_dollars ||
          book.yes ||
          []
        )
          .map(
            ([price, size]) => ({
              price:
                numberOrZero(
                  price
                ),

              size:
                numberOrZero(
                  size
                ),
            })
          )
          .sort(
            (a, b) =>
              b.price -
              a.price
          );

      const noBids =
        (
          book.no_dollars ||
          book.no ||
          []
        )
          .map(
            ([price, size]) => ({
              price:
                numberOrZero(
                  price
                ),

              size:
                numberOrZero(
                  size
                ),
            })
          )
          .sort(
            (a, b) =>
              b.price -
              a.price
          );

      const bestYesBid =
        yesBids[0] || null;

      const bestNoBid =
        noBids[0] || null;

      /*
       * Binary contract relationship:
       *
       * YES ask = 1 - best NO bid
       * NO ask  = 1 - best YES bid
       */
      const bestYesAsk =
        bestNoBid
          ? {
              price:
                Number(
                  (
                    1 -
                    bestNoBid.price
                  ).toFixed(4)
                ),

              size:
                bestNoBid.size,
            }
          : null;

      const bestNoAsk =
        bestYesBid
          ? {
              price:
                Number(
                  (
                    1 -
                    bestYesBid.price
                  ).toFixed(4)
                ),

              size:
                bestYesBid.size,
            }
          : null;

      return {
        success: true,

        bestYesBid,

        bestYesAsk,

        bestNoBid,

        bestNoAsk,

        yesBids,

        noBids,
      };
    }

    async function mapWithConcurrency(
      items,
      concurrency,
      fn
    ) {
      const results =
        new Array(
          items.length
        );

      let nextIndex = 0;

      async function worker() {
        while (true) {
          const index =
            nextIndex++;

          if (
            index >=
            items.length
          ) {
            return;
          }

          results[index] =
            await fn(
              items[index],
              index
            );
        }
      }

      const workerCount =
        Math.min(
          concurrency,
          items.length
        );

      const workers =
        Array.from(
          {
            length:
              workerCount,
          },
          () => worker()
        );

      await Promise.all(
        workers
      );

      return results;
    }

    if (includeDepth) {
      const comboRefs = [];

      for (
        const game of
          cleanGames
      ) {
        /*
         * Prioritize exact main-line
         * combos.
         */
        for (
          const combo of
            game.combos
              .mainLineMarkets
        ) {
          comboRefs.push(
            combo
          );
        }
      }

      /*
       * Protect the endpoint from
       * accidental giant orderbook scans.
       */
      const limitedRefs =
        comboRefs.slice(
          0,
          40
        );

      await mapWithConcurrency(
        limitedRefs,
        6,
        async (combo) => {
          combo.orderbook =
            await getOrderbook(
              combo.ticker
            );
        }
      );
    }

    /*
     * RAW DEBUG MODE
     *
     * Useful if combo matching is still
     * not working.
     */
    if (rawMode) {
      return res
        .status(200)
        .json({
          success: true,

          mode:
            "raw",

          updatedAt:
            new Date().toISOString(),

          comboDiscovery:
            "GET /markets?mve_filter=only",

          mveWindow: {
            minCloseTs,
            maxCloseTs,
          },

          counts: {
            games:
              cleanGames.length,

            standardMarkets:
              standardMarkets.length,

            rawMVECount:
              comboMarkets.length,

            mvePages:
              mveResult.pages,

            mveScanTruncated:
              mveResult.truncated,

            nflSameGameSpreadTotalCombos:
              analyzedCombos.length,
          },

          games:
            cleanGames,

          /*
           * Sample raw MVE records so we
           * can diagnose Kalshi's exact
           * MVE payload without returning
           * thousands of markets.
           */
          mveSample:
            comboMarkets.slice(
              0,
              100
            ),

          analyzedCombos:
            analyzedCombos.slice(
              0,
              500
            ),
        });
    }

    return res
      .status(200)
      .json({
        success: true,

        updatedAt:
          new Date().toISOString(),

        gameCount:
          cleanGames.length,

        comboDiscovery:
          "GET /markets?mve_filter=only",

        rawMVECount:
          comboMarkets.length,

        comboCount:
          analyzedCombos.length,

        mvePages:
          mveResult.pages,

        mveScanTruncated:
          mveResult.truncated,

        games:
          cleanGames,
      });
  } catch (error) {
    console.error(error);

    return res
      .status(500)
      .json({
        success: false,

        error:
          error.message,
      });
  }
}