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
      fetch(apiUrl2, { headers: { 'Content-Type': 'application/json' } }) // Netbeheerders
    ]);

    if (response0.ok && response2.ok) {
      const data0 = await response0.json();
      const data2 = await response2.json();

      // Kadastrale info zoek-adres
      const apiUrl3 = `https://service.pdok.nl/kadaster/kadastralekaart/wms/v5_0?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo&QUERY_LAYERS=Perceelvlak&layers=Perceelvlak&INFO_FORMAT=application/json&FEATURE_COUNT=1&I=2&J=2&CRS=EPSG:28992&STYLES=&WIDTH=5&HEIGHT=5&BBOX=${target2}`;
      const response3 = await fetch(apiUrl3, {
        headers: { 'Content-Type': 'application/json' },
      });

      const [x, y] = target2.split(',').map(coord => parseFloat(coord));

      // Retrieve BAG data for nearby objects
      const apiUrl4 = `https://service.pdok.nl/lv/bag/wfs/v2_0?service=WFS&version=2.0.0&request=GetFeature&propertyname=&count=200&outputFormat=json&srsName=EPSG:28992&typeName=bag:verblijfsobject&Filter=<Filter><DWithin><PropertyName>Geometry</PropertyName><gml:Point><gml:coordinates>${x},${y}</gml:coordinates></gml:Point><Distance units='m'>50</Distance></DWithin></Filter>`;
      const response4 = await fetch(apiUrl4, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (response3.ok && response4.ok) {
        const data3 = await response3.json();
        const data4 = await response4.json();

        // For each identificatie, fetch COORDS data
        const coordsData = await Promise.all(data4.features.map(async feature => {
          const identificatie = feature.properties?.identificatie;
          if (!identificatie) return null; // Skip if no identificatie

          const apiUrlCoords = `https://service.pdok.nl/lv/bag/wfs/v2_0?service=wfs&version=2.0.0&request=getfeature&typename=bag:pand&outputFormat=application/json&filter=%3Cfes:Filter%20xmlns:fes=%22http://www.opengis.net/fes/2.0%22%20xmlns:xsi=%22http://www.w3.org/2001/XMLSchema-instance%22%20xsi:schemaLocation=%22http://www.opengis.net/wfs/2.0%20http://schemas.opengis.net/wfs/2.0/wfs.xsd%22%3E%3Cfes:PropertyIsEqualTo%3E%3Cfes:PropertyName%3Eidentificatie%3C/fes:PropertyName%3E%3Cfes:Literal%3E${identificatie}%3C/fes:Literal%3E%3C/fes:PropertyIsEqualTo%3E%3C/fes:Filter%3E`;

          try {
            const response = await fetch(apiUrlCoords, {
              headers: { 'Content-Type': 'application/json' },
            });

            if (response.ok) {
              const data = await response.json();
              return { identificatie, COORDS: data };
            } else {
              return { identificatie, error: response.statusText };
            }
          } catch (error) {
            return { identificatie, error: error.message };
          }
        }));

        // Filter out any null results from the coordsData array
        const filteredCoordsData = coordsData.filter(item => item !== null);

        const combinedData = {
          BAG: data0,
          NETB: data2,
          KADAS: data3,
          NEARBY_BAG: data4,
          COORDS_DATA: filteredCoordsData // Add COORDS data to combinedData
        };

        res.status(200).json(combinedData);
      } else {
        res.status(500).json({ error: "Error fetching data from the WMS or WFS API" });
      }
    } else {
      res.status(500).json({ error: "Error fetching data from one or more APIs" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
