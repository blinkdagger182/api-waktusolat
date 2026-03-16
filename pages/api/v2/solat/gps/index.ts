import { NextApiRequest, NextApiResponse } from "next";
import gpsLatLongHandler from "./[lat]/[long]";

function firstString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const lat = firstString(req.query.lat) ?? firstString(req.query.latitude);
  const long = firstString(req.query.long) ?? firstString(req.query.lng) ?? firstString(req.query.longitude);

  if (lat === undefined || long === undefined) {
    return res.status(400).json({
      message: "Please specify parameter 'lat' & 'long'"
    });
  }

  req.query = {
    ...req.query,
    lat,
    long,
  };

  return gpsLatLongHandler(req, res);
}
