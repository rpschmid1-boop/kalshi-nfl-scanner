export default async function handler(req, res) {
  try {
    const BASE =
      "https://api.elections.kalshi.com/trade-api/v2";

    /*
     * Core NFL series.
     */
    const standardSeries = [
      { ticker: "KXNFLGAME", type: "moneyline" },
      { ticker: "KXNFLSPREAD", type: "spread" },
      { ticker: "KXNFLTOTAL", type: "total" },
    ];

    /*
     * Kalshi multivariate / combo series.
     *
     * KXMVESPORTSMULTIGAMEEXTENDED is the primary
     * combo series currently observed.
     *
     * KXMVESPORTSMULTIGAME is included as a fallback.
     *
     * You can override / extend this in Vercel with:
     *
     * KALSHI_COMBO_SERIES=
     * KXMVESPORTSMULTIGAMEEXTENDED,KXMVESPORTSMULTIGAME
     */
    const comboSeries = (
      process.env.KALSHI_COMBO_SERIES ||
      "KXMVESPORTSMULTIGAMEEXTENDED,KXMVESPORTSMULTIGAME"
    )
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((ticker) => ({
        ticker,
        type: "combo",
        optional: true,
      }));

    /*
     * Optional API filters.
     *
     * Examples:
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
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }

    /*
     * Pull every open market for a series.
     *
     * Combo series are optional because Kalshi may
     * add/remove/rename MVE series over time.
     */
    async function getSeriesMarkets(
      seriesTicker,
      type,
      optional = false
    ) {
      let markets = [];
      let cursor = null;
      let pages = 0;

      do {
        const url = new URL(`${BASE}/markets`);

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

        const response = await fetch(
          url.toString(),
          {
            headers: {
              Accept: "application/json",
            },
          }
        );

        if (!response.ok) {
          if (optional) {
            console.warn(
              `${seriesTicker}: optional series returned ${response.status}`
            );

            return [];
          }

          throw new Error(
            `${seriesTicker}: Kalshi returned ${response.status}`
          );
        }

        const data =
          await response.json();

        const pageMarkets =
          data.markets || [];

        markets.push(
          ...pageMarkets.map((m) => ({
            type,
            sourceSeries: seriesTicker,

            ticker: m.ticker,
            eventTicker:
              m.event_ticker,

            title: m.title,
            subtitle: m.subtitle,

            yesSubtitle:
              m.yes_sub_title,

            noSubtitle:
              m.no_sub_title,

            status: m.status,

            yesBid: numberOrZero(
              m.yes_bid_dollars
            ),

            yesAsk: numberOrZero(
              m.yes_ask_dollars
            ),

            noBid: numberOrZero(
              m.no_bid_dollars
            ),

            noAsk: numberOrZero(
              m.no_ask_dollars
            ),

            lastPrice: numberOrZero(
              m.last_price_dollars
            ),

            volume: numberOrZero(
              m.volume_fp
            ),

            volume24h: numberOrZero(
              m.volume_24h_fp
            ),

            openInterest: numberOrZero(
              m.open_interest_fp
            ),

            closeTime:
              m.close_time,

            expirationTime:
              m.expected_expiration_time,

            /*
             * Important fields for combos.
             */
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
              m.custom_strike || null,

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
         * Safety valve.
         *
         * 10 x 1000 is already a large scan.
         */
        if (pages >= 10) {
          console.warn(
            `${seriesTicker}: pagination safety limit hit`
          );

          break;
        }
      } while (cursor);

      return markets;
    }

    /*
     * Current midpoint.
     */
    function getMidpoint(market) {
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
     * Select market closest to 50%.
     *
     * Tie breakers:
     * 1. 24h volume
     * 2. tighter spread
     */
    function selectMainMarket(
      markets
    ) {
      const valid = markets
        .map((m) => {
          const midpoint =
            getMidpoint(m);

          const bidAskSpread =
            m.yesAsk > 0 &&
            m.yesBid > 0
              ? m.yesAsk -
                m.yesBid
              : 999;

          return {
            ...m,
            midpoint,

            distanceFrom50:
              midpoint !== null
                ? Math.abs(
                    midpoint - 0.5
                  )
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

    /*
     * Extract line number.
     *
     * Examples:
     *
     * Over 47.5 points scored
     * -> 47.5
     *
     * Chicago wins by over 3.5
     * -> 3.5
     */
    function extractNumber(text) {
      if (!text) return null;

      const match = text.match(
        /(?:over|under)\s+(-?\d+(?:\.\d+)?)/i
      );

      if (!match) {
        return null;
      }

      return Number(match[1]);
    }

    /*
     * Extract NFL game ID from
     * an underlying EVENT ticker.
     *
     * KXNFLSPREAD-26SEP13CHICAR
     * -> 26SEP13CHICAR
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

    function legType(
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

        noOutcome:
          market.noSubtitle ||
          null,

        line: extractNumber(
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
      };
    }

    /*
     * Fetch the standard NFL
     * series first.
     */
    const standardResults =
      await Promise.all(
        standardSeries.map((s) =>
          getSeriesMarkets(
            s.ticker,
            s.type,
            false
          )
        )
      );

    const standardMarkets =
      standardResults.flat();

    /*
     * Index underlying markets by
     * ticker so combo legs can be
     * translated back into human
     * readable outcomes.
     */
    const underlyingByTicker =
      new Map(
        standardMarkets.map(
          (m) => [
            m.ticker,
            m,
          ]
        )
      );

    /*
     * Pull Kalshi MVE / combo
     * markets separately.
     */
    const comboResults =
      await Promise.all(
        comboSeries.map((s) =>
          getSeriesMarkets(
            s.ticker,
            s.type,
            true
          )
        )
      );

    const comboMarkets =
      comboResults.flat();

    /*
     * Identify only the exact combo
     * structure relevant to this model:
     *
     * - exactly 2 legs
     * - both legs NFL
     * - one spread leg
     * - one total leg
     * - same underlying NFL game
     */
    function analyzeCombo(
      market
    ) {
      const legs =
        market.mveSelectedLegs ||
        [];

      if (legs.length !== 2) {
        return null;
      }

      const normalizedLegs =
        legs.map((leg) => {
          const underlying =
            underlyingByTicker.get(
              leg.market_ticker
            );

          const type =
            legType(
              leg.event_ticker
            );

          const side =
            String(
              leg.side || ""
            ).toLowerCase();

          let outcome = null;

          if (underlying) {
            if (side === "yes") {
              outcome =
                underlying.yesSubtitle ||
                underlying.title;
            }

            if (side === "no") {
              outcome =
                underlying.noSubtitle ||
                `NO: ${
                  underlying.yesSubtitle ||
                  underlying.title
                }`;
            }
          }

          return {
            type,

            eventTicker:
              leg.event_ticker,

            marketTicker:
              leg.market_ticker,

            side,

            outcome,

            yesSettlementValue:
              leg.yes_settlement_value_dollars ||
              null,

            gameId:
              extractNFLGameId(
                leg.event_ticker
              ),
          };
        });

      const spreadLeg =
        normalizedLegs.find(
          (x) =>
            x.type ===
            "spread"
        );

      const totalLeg =
        normalizedLegs.find(
          (x) =>
            x.type ===
            "total"
        );

      if (
        !spreadLeg ||
        !totalLeg
      ) {
        return null;
      }

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
      const combo of analyzedCombos
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

    /*
     * Group ordinary NFL markets
     * under game ID.
     */
    const games = {};

    for (
      const m of standardMarkets
    ) {
      const gameId =
        extractNFLGameId(
          m.eventTicker
        );

      if (!gameId) {
        continue;
      }

      if (!games[gameId]) {
        games[gameId] = {
          gameId,

          title: null,

          closeTime:
            m.closeTime,

          moneyline: [],
          spreads: [],
          totals: [],
        };
      }

      const game =
        games[gameId];

      if (
        !game.title &&
        m.title
      ) {
        game.title =
          m.title;
      }

      if (
        m.closeTime &&
        (!game.closeTime ||
          new Date(
            m.closeTime
          ) <
            new Date(
              game.closeTime
            ))
      ) {
        game.closeTime =
          m.closeTime;
      }

      if (
        m.type ===
        "moneyline"
      ) {
        game.moneyline.push(
          m
        );
      }

      if (
        m.type ===
        "spread"
      ) {
        game.spreads.push(
          m
        );
      }

      if (
        m.type ===
        "total"
      ) {
        game.totals.push(
          m
        );
      }
    }

    /*
     * Determine whether a combo
     * exactly matches the scanner's
     * selected main spread + total.
     */
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
                (m) =>
                  m.yesAsk > 0 &&
                  m.yesAsk < 1
              )
              .map((m) => ({
                ticker:
                  m.ticker,

                team:
                  m.yesSubtitle ||
                  m.subtitle ||
                  m.title,

                bid:
                  m.yesBid,

                ask:
                  m.yesAsk,

                midpoint:
                  getMidpoint(
                    m
                  ) !== null
                    ? Number(
                        getMidpoint(
                          m
                        ).toFixed(
                          4
                        )
                      )
                    : null,

                last:
                  m.lastPrice,

                volume24h:
                  m.volume24h,

                openInterest:
                  m.openInterest,
              }));

          const gameCombos =
            combosByGame[
              game.gameId
            ] || [];

          /*
           * Combos at ANY spread/total
           * line for this game.
           */
          const spreadTotalCombos =
            gameCombos
              .sort((a, b) => {
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

                /*
                 * Then higher volume.
                 */
                return (
                  b.volume24h -
                  a.volume24h
                );
              });

          /*
           * Exact combos for the main
           * spread and total selected
           * above.
           *
           * Ideally this contains
           * four quadrants:
           *
           * YES spread + YES total
           * YES spread + NO total
           * NO spread + YES total
           * NO spread + NO total
           */
          const mainCombos =
            spreadTotalCombos.filter(
              (combo) =>
                matchesMainMarkets(
                  combo,
                  mainSpread,
                  mainTotal
                )
            );

          const quadrantMap = {};

          for (
            const combo of mainCombos
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

            /*
             * This is the new section
             * the betting model needs.
             */
            combos: {
              totalSameGameSpreadTotal:
                spreadTotalCombos.length,

              mainLineComboCount:
                mainCombos.length,

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
                mainCombos,

              /*
               * Return a limited list of
               * other line combinations
               * for debugging / optimization.
               */
              otherLineMarkets:
                spreadTotalCombos
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
                    30
                  ),
            },

            marketCounts: {
              moneyline:
                game.moneyline
                  .length,

              spreads:
                game.spreads
                  .length,

              totals:
                game.totals
                  .length,

              combos:
                spreadTotalCombos
                  .length,
            },
          };
        })
        .filter(
          (game) =>
            game.moneyline
              .length > 0
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

    /*
     * Optional game filter.
     */
    if (requestedGameId) {
      cleanGames =
        cleanGames.filter(
          (game) =>
            game.gameId ===
            requestedGameId
        );
    }

    /*
     * Fetch actual order-book
     * depth for main-line combo
     * contracts when explicitly
     * requested.
     *
     * Use:
     *
     * /api/markets
     *   ?gameId=26SEP13CHICAR
     *   &depth=true
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
       * Binary-market relationship:
       *
       * best YES ask =
       * 1 - best NO bid
       *
       * best NO ask =
       * 1 - best YES bid
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

    /*
     * Simple concurrency limiter.
     */
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

      const workers =
        Array.from(
          {
            length:
              Math.min(
                concurrency,
                items.length
              ),
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
        const game of cleanGames
      ) {
        for (
          const combo of
            game.combos
              .mainLineMarkets
        ) {
          comboRefs.push({
            game,
            combo,
          });
        }
      }

      /*
       * Safety valve:
       * don't accidentally issue
       * hundreds of orderbook calls.
       */
      const limitedRefs =
        comboRefs.slice(
          0,
          40
        );

      await mapWithConcurrency(
        limitedRefs,
        6,
        async ({ combo }) => {
          combo.orderbook =
            await getOrderbook(
              combo.ticker
            );
        }
      );
    }

    /*
     * Debug/raw mode.
     */
    if (rawMode) {
      return res
        .status(200)
        .json({
          success: true,

          mode: "raw",

          updatedAt:
            new Date().toISOString(),

          comboSeries:
            comboSeries.map(
              (x) =>
                x.ticker
            ),

          counts: {
            games:
              cleanGames.length,

            standardMarkets:
              standardMarkets.length,

            rawComboMarkets:
              comboMarkets.length,

            nflSameGameSpreadTotalCombos:
              analyzedCombos.length,
          },

          games:
            cleanGames,

          /*
           * Useful for diagnosing
           * unfamiliar Kalshi combo
           * structures.
           */
          analyzedCombos,
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

        comboSeries:
          comboSeries.map(
            (x) =>
              x.ticker
          ),

        comboCount:
          analyzedCombos.length,

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