export default async function handler(req, res) {
  try {
    /*
     * Keep the standard NFL feed on the endpoint
     * we already know is working.
     *
     * Use Kalshi's documented public API host for
     * multivariate collection/event discovery.
     */
    const STANDARD_BASE =
      "https://api.elections.kalshi.com/trade-api/v2";

    const MVE_BASE =
      "https://external-api.kalshi.com/trade-api/v2";

    const standardSeries = [
      { ticker: "KXNFLGAME", type: "moneyline" },
      { ticker: "KXNFLSPREAD", type: "spread" },
      { ticker: "KXNFLTOTAL", type: "total" },
    ];

    /*
     * Supported calls:
     *
     * /api/markets
     *
     * /api/markets?gameId=26SEP13CHICAR
     *
     * /api/markets?gameId=26SEP13CHICAR&depth=true
     *
     * /api/markets?gameId=26SEP13CHICAR&raw=true
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

      return Number.isFinite(n)
        ? n
        : 0;
    }

    /*
     * Simple concurrency helper.
     */
    async function mapWithConcurrency(
      items,
      concurrency,
      fn
    ) {
      if (!items.length) {
        return [];
      }

      const output =
        new Array(items.length);

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

          output[index] =
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

      await Promise.all(
        Array.from(
          {
            length:
              workerCount,
          },
          () => worker()
        )
      );

      return output;
    }

    /*
     * Normalize standard Kalshi market objects.
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
         * MVE fields when present.
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

        isProvisional:
          Boolean(
            market.is_provisional
          ),
      };
    }

    /*
     * Pull all open markets from
     * a standard Kalshi NFL series.
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
          new URL(
            `${STANDARD_BASE}/markets`
          );

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

        markets.push(
          ...(data.markets || []).map(
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

        if (pages >= 10) {
          console.warn(
            `${seriesTicker}: pagination safety cap hit`
          );

          break;
        }
      } while (cursor);

      return markets;
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
     * Main line = market nearest 50/50.
     */
    function selectMainMarket(
      markets
    ) {
      return (
        markets
          .map((market) => {
            const midpoint =
              getMidpoint(
                market
              );

            const spread =
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
                      midpoint - 0.5
                    )
                  : 999,

              bidAskSpread:
                spread,
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
          })[0] || null
      );
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

        noOutcome:
          market.noSubtitle ||
          null,

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
     * STEP 1
     *
     * Pull normal NFL markets.
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

    /*
     * Underlying ticker lookup.
     *
     * This lets us translate MVE legs into
     * human-readable NFL outcomes later.
     */
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

          title:
            null,

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
        (
          !game.closeTime ||
          new Date(
            market.closeTime
          ) <
            new Date(
              game.closeTime
            )
        )
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
     * Precompute main spread + total
     * for each game.
     */
    const preparedGames =
      Object.values(games)
        .map((game) => ({
          ...game,

          mainSpread:
            selectMainMarket(
              game.spreads
            ),

          mainTotal:
            selectMainMarket(
              game.totals
            ),
        }))
        .filter(
          (game) =>
            game.moneyline.length >
              0
        );

    /*
     * If gameId supplied, only do
     * expensive combo discovery for that game.
     */
    const comboTargetGames =
      requestedGameId
        ? preparedGames.filter(
            (game) =>
              game.gameId ===
              requestedGameId
          )
        : preparedGames.filter(
            (game) =>
              game.mainSpread &&
              game.mainTotal
          );

    /*
     * STEP 2
     *
     * Find multivariate collections associated
     * with an underlying event ticker.
     *
     * Kalshi supports:
     *
     * GET /multivariate_event_collections
     * ?status=open
     * &associated_event_ticker=...
     */
    async function getCollectionsForEvent(
      eventTicker
    ) {
      let collections = [];
      let cursor = null;
      let pages = 0;

      do {
        const url =
          new URL(
            `${MVE_BASE}/multivariate_event_collections`
          );

        url.searchParams.set(
          "status",
          "open"
        );

        url.searchParams.set(
          "associated_event_ticker",
          eventTicker
        );

        url.searchParams.set(
          "limit",
          "200"
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
            `Collections for ${eventTicker}: Kalshi returned ${response.status}`
          );
        }

        const data =
          await response.json();

        collections.push(
          ...(
            data.multivariate_contracts ||
            []
          )
        );

        cursor =
          data.cursor || null;

        pages++;

        if (pages >= 10) {
          console.warn(
            `Collection pagination cap hit for ${eventTicker}`
          );

          break;
        }
      } while (cursor);

      return collections;
    }

    /*
     * Query collections using the spread EVENT,
     * then verify the collection also contains
     * the matching total EVENT.
     *
     * This avoids searching Kalshi's entire
     * multivariate universe.
     */
    const collectionLookupResults =
      await mapWithConcurrency(
        comboTargetGames,
        8,
        async (game) => {
          if (
            !game.mainSpread ||
            !game.mainTotal
          ) {
            return {
              gameId:
                game.gameId,

              collections: [],
            };
          }

          const spreadEventTicker =
            game.mainSpread.eventTicker;

          const totalEventTicker =
            game.mainTotal.eventTicker;

          const foundCollections =
            await getCollectionsForEvent(
              spreadEventTicker
            );

          /*
           * Prefer collections whose metadata
           * explicitly says both NFL events
           * belong to the collection.
           */
          const matchingCollections =
            foundCollections.filter(
              (collection) => {
                const tickers =
                  Array.isArray(
                    collection.associated_event_tickers
                  )
                    ? collection.associated_event_tickers
                    : [];

                return (
                  tickers.includes(
                    spreadEventTicker
                  ) &&
                  tickers.includes(
                    totalEventTicker
                  )
                );
              }
            );

          return {
            gameId:
              game.gameId,

            spreadEventTicker,

            totalEventTicker,

            queriedCollectionCount:
              foundCollections.length,

            collections:
              matchingCollections,
          };
        }
      );

    /*
     * Map collection diagnostics by game.
     */
    const collectionInfoByGame =
      {};

    for (
      const result of
        collectionLookupResults
    ) {
      collectionInfoByGame[
        result.gameId
      ] = result;
    }

    /*
     * Deduplicate collection tickers.
     */
    const collectionTickerSet =
      new Set();

    for (
      const result of
        collectionLookupResults
    ) {
      for (
        const collection of
          result.collections || []
      ) {
        if (
          collection.collection_ticker
        ) {
          collectionTickerSet.add(
            collection.collection_ticker
          );
        }
      }
    }

    const collectionTickers =
      Array.from(
        collectionTickerSet
      );

    /*
     * STEP 3
     *
     * Pull multivariate EVENTS only for
     * relevant collections.
     *
     * with_nested_markets=true makes Kalshi
     * return each event's actual combo markets,
     * including mve_selected_legs.
     */
    async function getMultivariateEventsForCollection(
      collectionTicker
    ) {
      let events = [];
      let cursor = null;
      let pages = 0;

      do {
        const url =
          new URL(
            `${MVE_BASE}/events/multivariate`
          );

        url.searchParams.set(
          "collection_ticker",
          collectionTicker
        );

        url.searchParams.set(
          "with_nested_markets",
          "true"
        );

        url.searchParams.set(
          "limit",
          "200"
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
            `MVE events for ${collectionTicker}: Kalshi returned ${response.status}`
          );
        }

        const data =
          await response.json();

        events.push(
          ...(data.events || [])
        );

        cursor =
          data.cursor || null;

        pages++;

        /*
         * Safety cap:
         * 10 x 200 = 2,000 events per collection.
         */
        if (pages >= 10) {
          console.warn(
            `MVE event pagination cap hit for ${collectionTicker}`
          );

          break;
        }
      } while (cursor);

      return {
        collectionTicker,

        events,

        pages,
      };
    }

    const collectionEventResults =
      await mapWithConcurrency(
        collectionTickers,
        6,
        async (
          collectionTicker
        ) =>
          getMultivariateEventsForCollection(
            collectionTicker
          )
      );

    /*
     * Flatten nested markets.
     */
    const nestedComboMarkets = [];

    const multivariateEventDiagnostics =
      [];

    for (
      const result of
        collectionEventResults
    ) {
      for (
        const event of
          result.events
      ) {
        const markets =
          Array.isArray(
            event.markets
          )
            ? event.markets
            : [];

        multivariateEventDiagnostics.push({
          collectionTicker:
            result.collectionTicker,

          eventTicker:
            event.event_ticker,

          seriesTicker:
            event.series_ticker,

          title:
            event.title,

          category:
            event.category,

          nestedMarketCount:
            markets.length,
        });

        for (
          const market of
            markets
        ) {
          nestedComboMarkets.push({
            ...normalizeMarket(
              market,
              "combo"
            ),

            parentCollectionTicker:
              result.collectionTicker,

            parentMveEventTicker:
              event.event_ticker,

            parentMveSeriesTicker:
              event.series_ticker,

            parentMveTitle:
              event.title,

            parentMveCategory:
              event.category,
          });
        }
      }
    }

    /*
     * Deduplicate nested combo markets.
     */
    const comboMarkets =
      Array.from(
        new Map(
          nestedComboMarkets.map(
            (market) => [
              market.ticker,
              market,
            ]
          )
        ).values()
      );

    /*
     * STEP 4
     *
     * Identify exact same-game:
     *
     * spread + total
     *
     * two-leg combos.
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
       * Must be the SAME NFL game.
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
          market.mveCollectionTicker ||
          market.parentCollectionTicker ||
          null,

        parentMveEventTicker:
          market.parentMveEventTicker ||
          null,

        parentMveSeriesTicker:
          market.parentMveSeriesTicker ||
          null,

        title:
          market.title ||
          market.parentMveTitle,

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
        .map(
          analyzeCombo
        )
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
      ].push(
        combo
      );
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
     * STEP 5
     *
     * Build response.
     */
    let cleanGames =
      preparedGames
        .map((game) => {
          const mainSpread =
            game.mainSpread;

          const mainTotal =
            game.mainTotal;

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

          const mainLineCombos =
            gameCombos.filter(
              (combo) =>
                matchesMainMarkets(
                  combo,
                  mainSpread,
                  mainTotal
                )
            );

          const quadrantMap = {};

          for (
            const combo of
              mainLineCombos
          ) {
            quadrantMap[
              combo.quadrantKey
            ] = combo;
          }

          const collectionInfo =
            collectionInfoByGame[
              game.gameId
            ] || {
              collections: [],
            };

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

            comboDiscovery: {
              spreadEventTicker:
                mainSpread?.eventTicker ||
                null,

              totalEventTicker:
                mainTotal?.eventTicker ||
                null,

              queriedCollectionCount:
                collectionInfo
                  .queriedCollectionCount ||
                0,

              matchingCollectionCount:
                (
                  collectionInfo.collections ||
                  []
                ).length,

              matchingCollections:
                (
                  collectionInfo.collections ||
                  []
                ).map(
                  (collection) => ({
                    collectionTicker:
                      collection.collection_ticker,

                    seriesTicker:
                      collection.series_ticker,

                    title:
                      collection.title,

                    description:
                      collection.description,

                    associatedEventTickers:
                      collection.associated_event_tickers ||
                      [],
                  })
                ),
            },

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
     * STEP 6
     *
     * Optional order-book depth.
     */
    async function getOrderbook(
      ticker
    ) {
      const url =
        new URL(
          `${STANDARD_BASE}/markets/${encodeURIComponent(
            ticker
          )}/orderbook`
        );

      url.searchParams.set(
        "depth",
        String(
          depthLevels
        )
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
          success:
            false,

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
        success:
          true,

        bestYesBid,

        bestYesAsk,

        bestNoBid,

        bestNoAsk,

        yesBids,

        noBids,
      };
    }

    if (includeDepth) {
      const comboRefs = [];

      for (
        const game of
          cleanGames
      ) {
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

      await mapWithConcurrency(
        comboRefs.slice(
          0,
          40
        ),
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
     * RAW DEBUG OUTPUT
     */
    if (rawMode) {
      return res
        .status(200)
        .json({
          success:
            true,

          mode:
            "raw",

          updatedAt:
            new Date().toISOString(),

          gameCount:
            cleanGames.length,

          comboDiscoveryMethod:
            "multivariate collections -> events/multivariate?collection_ticker=...&with_nested_markets=true",

          diagnostics: {
            comboTargetGameCount:
              comboTargetGames.length,

            collectionTickerCount:
              collectionTickers.length,

            collectionTickers,

            multivariateEventCount:
              multivariateEventDiagnostics.length,

            rawNestedComboMarketCount:
              comboMarkets.length,

            nflSameGameSpreadTotalComboCount:
              analyzedCombos.length,
          },

          collectionLookups:
            collectionLookupResults,

          multivariateEvents:
            multivariateEventDiagnostics.slice(
              0,
              500
            ),

          comboMarketSample:
            comboMarkets.slice(
              0,
              200
            ),

          analyzedComboSample:
            analyzedCombos.slice(
              0,
              500
            ),

          games:
            cleanGames,
        });
    }

    /*
     * NORMAL OUTPUT
     */
    return res
      .status(200)
      .json({
        success:
          true,

        updatedAt:
          new Date().toISOString(),

        gameCount:
          cleanGames.length,

        comboDiscoveryMethod:
          "targeted multivariate collections",

        collectionCount:
          collectionTickers.length,

        rawNestedComboMarketCount:
          comboMarkets.length,

        comboCount:
          analyzedCombos.length,

        games:
          cleanGames,
      });
  } catch (error) {
    console.error(
      error
    );

    return res
      .status(500)
      .json({
        success:
          false,

        error:
          error.message,
      });
  }
}