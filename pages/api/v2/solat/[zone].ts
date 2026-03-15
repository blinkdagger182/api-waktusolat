import {NextApiRequest, NextApiResponse} from "next";
import {initializeApp} from "firebase/app";
import {collection, doc, getDoc, getFirestore, Timestamp} from "firebase/firestore";
import { getPrayerMonthFromSupabase, isSupabaseConfigured } from "../../../../lib/supabase-admin";
import { getMalaysiaCurrentDate, monthNameToNumber, resolveQueryMonth, resolveQueryYear } from "../../../../lib/waktu-solat";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const {zone, year, month, debug} = req.query;

    let queryYear: number;
    const malaysiaCurrentDate = getMalaysiaCurrentDate();

    try {
        queryYear = resolveQueryYear(year, malaysiaCurrentDate);
    } catch (error) {
        res.status(500).json({
            error: error.message
        });
        return;
    }

    // check month if an integer
    let fetch_for_month;
    try {
        fetch_for_month = resolveQueryMonth(month, malaysiaCurrentDate);
    } catch (error) {
        return res.status(500).json({
            error: error.message
        });
    }

    const zoneCode = zone.toString().toUpperCase();
    const response: any = {};
    if (debug && debug == '1') response['debug'] = {
        'malaysiaDate' : malaysiaCurrentDate.toLocaleDateString()
    };
    response['zone'] = zoneCode;
    response['year'] = queryYear;
    response['month'] = fetch_for_month;
    response['month_number'] = monthNameToNumber(fetch_for_month);

    if (isSupabaseConfigured()) {
        const supabaseRecord = await getPrayerMonthFromSupabase(zoneCode, queryYear, fetch_for_month);
        if (!supabaseRecord) {
            res.status(404).json({
                error: `No data found for zone: ${zoneCode} for ${fetch_for_month.toString().toUpperCase()}/${queryYear}`
            });
            return;
        }

        response['last_updated'] = supabaseRecord.last_updated;
        response['prayers'] = supabaseRecord.prayers;

        res.setHeader('Cache-Control', 'public, s-maxage=43200');
        res.status(200).json(response);
        return;
    }

    const firebaseConfig = {
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: "malaysia-waktu-solat.firebaseapp.com",
        databaseURL: "https://malaysia-waktu-solat.firebaseio.com",
        projectId: "malaysia-waktu-solat",
        storageBucket: "malaysia-waktu-solat.appspot.com",
        messagingSenderId: "1012545476549",
        appId: "1:1012545476549:web:eeefcfec57ab2ab05a9dac",
        measurementId: "G-8K4GZ6RK8R"
    };

    const firebaseApp = initializeApp(firebaseConfig);
    const db = getFirestore(firebaseApp);
    const monthCollectionRef = collection(db, `waktusolat/${queryYear}/${fetch_for_month}`);
    const docRef = doc(monthCollectionRef, zoneCode);
    const docSnapshot = await getDoc(docRef);

    if (!docSnapshot.exists()) {
        res.status(404).json({
            error: `No data found for zone: ${zoneCode} for ${fetch_for_month.toString().toUpperCase()}/${queryYear}`
        });
        return;
    }

    const documentData = docSnapshot.data();

    // build response
    // record the last update time
    const rootCollection = collection(db, `waktusolat`);
    const yearDocRef = doc(rootCollection, queryYear.toString());
    const yearDocData = await getDoc(yearDocRef);
    const lastFetchTimestamp: Timestamp = yearDocData.data().last_updated[fetch_for_month];
    response['last_updated'] = lastFetchTimestamp.toDate();

    // lastly, assign the prayer time data
    response['prayers'] = documentData.prayerTime;

    res.setHeader('Cache-Control', 'public, s-maxage=43200') // 12 hours cache
    res.status(200).json(response)
}
