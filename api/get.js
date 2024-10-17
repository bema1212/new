export default async function handler(req, res) {
  try {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const { target0, target2 } = req.query;

    if (!target0 || !target2) {
      return res.status(400).json({ error: "Both target0 and target2 parameters are required" });
    }

    const apiUrl0 = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup?id=${target0}`;
    const apiUrl2 = `https://opendata.polygonentool.nl/wfs?service=wfs&version=2.0.0&request=getfeature&typename=se:OGC_Warmtevlak,se:OGC_Elektriciteitnetbeheerdervlak,se:OGC_Gasnetbeheerdervlak,se:OGC_Telecomvlak,se:OGC_Waternetbeheerdervlak,se:OGC_Rioleringsvlakken&propertyname=name,disciplineCode&outputformat=application/json&srsname=EPSG:28992&bbox=${target2}`;

    const [response0, response2] = await Promise.all([
      fetch(apiUrl0, { headers: { 'Content-Type': 'application/json' } }), // BAG-info obv zoek-adres
      fetch(apiUrl2, { headers: { 'Content-Type': 'application/json' } })  // Netbeheerders
    ]);

    if (response0.ok && response2.ok) {
      const data0 = await response0.json();
      const data2 = await response2.json();

      // Kadastrale info zoek-adres
      const apiUrl3 = `https://service.pdok.nl/kadaster/kadastralekaart/wms/v5_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&QUERY_LAYERS=Perceelvlak&layers=Perceelvlak&INFO_FORMAT=application/json&FEATURE_COUNT=1&I=2&J=2&CRS=EPSG:28992&STYLES=&WIDTH=5&HEIGHT=5&BBOX=${target2}`;
      const response3 = await fetch(apiUrl3, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (response3.ok) {
        const data3 = await response3.json();

        // Verblijfsobject features (data4) fetching from target2
        const apiUrl4 = `https://service.pdok.nl/lv/bag/wfs/v2_0?service=WFS&version=2.0.0&request=GetFeature&typename=bag:verblijfsobject&outputFormat=application/json&srsName=EPSG:28992&bbox=${target2}`;
        const response4 = await fetch(apiUrl4, {
          headers: { 'Content-Type': 'application/json' },
        });

        if (response4.ok) {
          const data4 = await response4.json();

          // Fetch EPON data for each identificatie in data4
          const eponData = await Promise.all(data4.features.map(async feature => {
            const identificatie = feature.properties?.identificatie;
            if (!identificatie) return null; // Skip if no identificatie

            const apiUrlEpon = `https://yxorp-pi.vercel.app/api/handler?url=https://public.ep-online.nl/api/v4/PandEnergielabel/AdresseerbaarObject/${identificatie}`;

            try {
              const response = await fetch(apiUrlEpon, {
                headers: {
                  "Authorization": process.env.AUTH_TOKEN,
                  'Content-Type': 'application/json',
                }
              });

              if (response.ok) {
                const data = await response.json();
                return { identificatie, EPON: data };
              } else {
                return { identificatie, error: response.statusText };
              }
            } catch (error) {
              return { identificatie, error: error.message };
            }
          }));

          // Filter out any null results from the eponData array
          const filteredEponData = eponData.filter(item => item !== null);

          // Combine EPON data with data4 features
          const enrichedFeatures = data4.features.map(feature => {
            const identificatie = feature.properties?.identificatie;
            const eponInfo = filteredEponData.find(item => item.identificatie === identificatie);

            return {
              ...feature,
              EPON: eponInfo ? eponInfo.EPON : null,
              error: eponInfo ? eponInfo.error : null
            };
          });

          const combinedData = {
            BAG: data0,
            NETB: data2,
            KADAS: data3,
            enrichedFeatures
          };

          res.status(200).json(combinedData);
        } else {
          res.status(500).json({ error: "Error fetching verblijfsobject data from WFS API" });
        }
      } else {
        res.status(500).json({ error: "Error fetching data from the WMS API" });
      }
    } else {
      res.status(500).json({ error: "Error fetching data from one or more APIs" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
