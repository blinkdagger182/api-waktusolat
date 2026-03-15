import axios from "axios";
import { lookupZone } from "../../../lib/zone-lookup";


export default async function handler(req, res) {
    const {lat, long} = req.query;

    // check if lat & lang is undefined
    if (lat === undefined || long === undefined) {
        return res.status(400).send({
            message: "Please specify parameter 'lat' & 'long'"
        });
    }

    let geojsonData;

    // fetch geojson
    try {
        geojsonData = await getZonesGeoJson();
    } catch (error) {
        return res.status(500).json({
            error: error.message
        });
    }

    const match = lookupZone(geojsonData, lat, long);

    if (!match) {
        return res.status(404).json({
            error: `No zone found for the supplied coordinates. Are you outside of Malaysia?`,
        });
    }

    return res.status(200).json(match)
}

async function getZonesGeoJson() {
    const geoJsonDataSource = 'https://raw.githubusercontent.com/mptwaktusolat/malaysia.geojson/master/malaysia.district-jakim.geojson';
    const res = await axios.get(geoJsonDataSource);
    return res.data;
}
