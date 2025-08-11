/* ------------------------------------------------*/
/* Imports and Includes (Dependencies for the app to run) */
const express = require('express');
const https = require('https'); // or 'http' for non-HTTPS requests
const fs = require('fs');
const path = require('path');
const req = require('express/lib/request');
const app = express();
//Remember, gitignore is excluding this
const secret = require('./secret.json');

/* ------------------------------------------------*/

/*-------------------------------------------------*/
/* Configuration variables ------------------------*/
const userArgs = process.argv.slice(2);
//USAGE: node app.js startTimeHourInt endTimeHourInt altitudeThreshold
console.log(userArgs);

const port = 45699;
const requestIntervalInSeconds = tryGetNum(userArgs[3], 210);
const maximumFailures = 10;
const ground_altitude_threshold = tryGetNum(userArgs[2], 750);
const timeframe_startHour = tryGetNum(userArgs[0], 12); // 12:00 PM
const timeframe_endHour = tryGetNum(userArgs[1], 20); // 8:00 PM
/*-------------------------------------------------*/

/*-------------------------------------------------*/
/* API Credentials         ------------------------*/
const RAPIDAPI_KEY = secret.RAPIDAPI_KEY;
const RAPIDAPI_HOST = secret.RAPIDAPI_HOST;
/*-------------------------------------------------*/

/*-------------------------------------------------*/
/* 15 mile X 15 Mile box   ------------------------*/
const HOME_LAT = secret.HOME_LAT;
const HOME_LNG = secret.HOME_LNG;
const BL_LAT = secret.BL_LAT;
const BL_LNG = secret.BL_LNG;
const TR_LAT = secret.TR_LAT;
const TR_LNG = secret.TR_LNG;
/*-------------------------------------------------*/

/*-------------------------------------------------*/
/* Other global variables  ------------------------*/
var numFailures = 0;
const dataFilePath = path.join(__dirname, 'data.json');
const processedDataFilePath = path.join(__dirname, 'processed.json');
/*-------------------------------------------------*/

/* HTTP GET - http://localhost:{port}/ */
app.get('/', (req, res) => {
    res.send(`Server running on http://localhost:${port}.`);
});

/* HTTP GET - http://localhost:{port}/flights */
app.get('/flights', async (req, res) => {
    readJsonFile(dataFilePath, (err, jsonData) => {
        if (err) {
            return res.status(500).json({ error: 'Internal server error' });
        }
        jsonData.timestamp = getISODateLocal();
        res.json(jsonData); // Send the parsed JSON data as a response
    });
});

/* HTTP GET - http://localhost:{port}/processedflights */
app.get('/processedflights', (req, res) => {

    readJsonFile(processedDataFilePath, (err, jsonData) => {
        if (err) {
            return res.status(500).json({ error: 'Internal server error' });
        }
        jsonData.timestamp = getISODateLocal();
        res.json(jsonData); // Send the parsed JSON data as a response
    });
});

/* Server Startup (App Entry Point) */
app.listen(port, () => {
    console.log('Starting server...');
    console.log(`Server running on http://localhost:${port}`);

    if (fs.existsSync(dataFilePath)) {
        console.log(`Data file found.`);
    }
    if (fs.existsSync(processFlightData)) {
        console.log(`Processed data file found.`);
    }
    
    if (isInTimeframe()) {
        getAndSaveFlightData();
    }
    
    startScheduledRun();
});

/* Helper Functions */
function startScheduledRun() {
    console.log(`Beginning scheduled runs every ${requestIntervalInSeconds} seconds.`);
    var intervalId = setInterval(() => {
        console.log(`Checking if within timeframe after ${requestIntervalInSeconds} seconds.`);
        if (numFailures < maximumFailures) {
            if (isInTimeframe()) {
                //retrieve flights from API and store data in JSON saved to disk
                console.log(`Executing getAndSaveFlightData().`);
                getAndSaveFlightData();
            }
        }
        else {
            //if the call to the API or data parsing fails for some reason more than maximumFailures,
            // stop the whole process
            //this will exit this whole closure here upon failure and won't continue to execute
            console.log(`Stopping scheduled run due to repeated (${numFailures}) failures.`)
            clearInterval(intervalId);
        }
    }, requestIntervalInSeconds * 1000);
}


function readJsonFile(filePath, callback) {
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading JSON file:', err);
            return callback(err, null);
        }

        try {
            const jsonData = JSON.parse(data);
            callback(null, jsonData);
        } catch (parseError) {
            console.error('Error parsing JSON:', parseError);
            callback(parseError, null);
        }
    });
}

async function getAndSaveFlightData() {
    console.log("Getting flight data...");
    const url = `https://${RAPIDAPI_HOST}/flights/list-in-boundary?bl_lat=${BL_LAT}&bl_lng=${BL_LNG}&tr_lat=${TR_LAT}&tr_lng=${TR_LNG}`;
    const options = {
        method: 'GET',
        headers: {
            "x-rapidapi-key": RAPIDAPI_KEY, 
            "x-rapidapi-host": RAPIDAPI_HOST
        }
    };
    console.log(`URL: ${url}`)

    //Set up the API request, including the options defined above and what we want the server to do with the data 
    // once the download task is complete
    const request = https.request(url, options, (apiResponse) => {
        let data = '';

        apiResponse.on('data', (chunk) => {
            data += chunk;
        });

        apiResponse.on('end', () => {
            try {
                console.log(`Data received. Parsing...`)
                //Parse the received JSON data into an object (mostly to ensure it is valid)
                const jsonData = JSON.parse(data); 

                //Pretty print for readability
                const jsonString = JSON.stringify(jsonData, null, 2); 

                console.log(`Writing downloaded data to file...`)
                // Write the JSON string to the file
                fs.writeFile(dataFilePath, jsonString, (err) => { 
                    if (err) {
                        //something went wrong, report error to console and return
                        console.error('Error writing to file:', err);
                    }
                    else {
                        //if we get here, we were succesful in downloading the data and writing it to the file
                        console.log(`Data successfully written to ${dataFilePath}`);
                    }
                });

                processFlightData(jsonData);

            } catch (parseError) {
                //something went wrong while parsing the downloaded json data, report error to console and return
                console.error('Error parsing JSON response:', parseError);
                numFailures++;
            }
        });
    });

    //Define the error callback for the request (aka what will happen if the API request fails)
    request.on('error', (error) => {
        //report error to console and return
        console.error('Error making HTTP request:', error);
        numFailures++;
        return;
    });

    //Send the request
    request.end(); 
}

/* Misc Unused functions */
function processFlightData(jsonData) {
    function parseAircraftsArray(inputArray) {
        //parseAircraft() is only to be used by parseAircraftsArray(), so it is placed 
        // within the scope of this function so it can't be called anywhere else.
        function parseAircraft(d) {
            //Filter out flights below the altitude threshold
            var altitude = tryGetNum(d[5], 0);
            if (altitude < ground_altitude_threshold) {
                return null;
            }

            var bearing = null;
            var direction = 'N/A';
            var distance_miles = 0;
            var speed_mph = 0;

            var raw_cs = `-`;
            if (d[14] != null && d[14] != ''){
                raw_cs = tryGetString(d[14], `-`);
            } else {
                if (d[10] != null && d[10] != '') {
                    raw_cs = tryGetString(d[10], `-`);
                } else {
                    if (d[8] != null && d[8] != '') {
                        raw_cs = tryGetString(d[8], `-`);
                    }
                }
            }
            var cs = raw_cs.toString().trim();
            var track = interpretTrack(d[6]); //Index 6 should be the heading
            var origin = tryGetString(d[12], `-`);
            var dest = tryGetString(d[13], `-`);
            
            var spd_kt = tryGetNum(d[6], 0);
            var aircraft_type = tryGetString(d[9], `-`);
            var reg = tryGetString(d[10], `-`);
            var lat = tryGetNum(d[2], 0.0)
            var lng = tryGetNum(d[3], 0.0);

            var aircraft_type_desc = lookupAircraftType(aircraft_type);

            distance_miles = calculate_distance(HOME_LAT, HOME_LNG, lat, lng);
            speed_mph = parseInt(spd_kt * 1.151);
            bearing = get_bearing(HOME_LAT, HOME_LNG, lat, lng)
            direction = get_direction_from_bearing(bearing)

            var temp = {
                "callsign": `${cs}`,
                "route"  : `${origin}->${dest}`,
                "alt"    : `${altitude}`,
                "spd_kt" : `${spd_kt}`, //# Keep knots in the data
                "spd_mph": `${speed_mph}`, //# Add mph
                "type"   : `${aircraft_type_desc}`, //# Use the descriptive type
                "reg"    : `${reg}`,
                "lat"    : `${lat}`,
                "lng"    : `${lng}`,
                "heading": `${track}`, //# Now can be N, NE, E, SE, S, SW, W, NW or numerical
                "location": `${direction}`, //# Store for later use
                "distance_miles": `${distance_miles}`,
            };

            return temp;
        }

        console.log(`'aircraft' shape parse`);

        var ret = [];

        inputArray.forEach(element => {
            var temp = parseAircraft(element);
            if (temp != null) { ret.push(temp); }
        });

        return ret;
    }

    function parseDataDictionary(inputDictionary) {
        //parseDatum() is only to be used by parseDataDictionary(), so it is placed 
        // within the scope of this function so it can't be called anywhere else.
        function parseDatum(h) {
            // TO-DO: test this with real data
            
            //Filter out flights below the altitude threshold
            var altitude = tryGetNum(h.altitude, 0);
            if (altitude < ground_altitude_threshold) {
                return null;
            }
            
            var track = 'N/A';
            //var bearing = null;
            var direction = 'N/A';
            var origin = `-`;
            var distance_miles = 0;
            var speed_mph = 0;

            var cs = tryGetString(h.callsign.trim(), `-`);

            track = interpretTrack(h.track);

            var origin = tryGetString(h.origin, `-`);
            var dest = tryGetString(h.destination, `-`);
            var altitude = tryGetNum(h.altitude, 0);
            var spd_kt = tryGetNum(h.speed, 0);
            var aircraft_type = tryGetString(h.aircraftType, `-`);
            var reg = tryGetString(h.registration, `-`);
            var lat = tryGetNum(h.latitude, 0.0)
            var lng = tryGetNum(h.longitude, 0.0);

            var aircraft_type_desc = lookupAircraftType(aircraft_type);

            distance_miles = calculate_distance(HOME_LAT, HOME_LNG, lat, lng);
            speed_mph = parseInt(spd_kt * 1.151);
            bearing = get_bearing(HOME_LAT, HOME_LNG, lat, lng)
            direction = get_direction_from_bearing(bearing)

            var temp = {
                "callsign": `${cs}`,
                "route"  : `${origin}->${dest}`,
                "alt"    : `${altitude}`,
                "spd_kt" : `${spd_kt}`, //# Keep knots in the data
                "spd_mph": `${speed_mph}`, //# Add mph
                "type"   : `${aircraft_type_desc}`, //# Use the descriptive type
                "reg"    : `${reg}`,
                "lat"    : `${lat}`,
                "lng"    : `${lng}`,
                "heading": `${track}`, //# Now can be N, NE, E, SE, S, SW, W, NW or numerical
                "location": `${direction}`, //# Store for later use
                "distance_miles": `${distance_miles}`,
            };

            return temp;
        }

        console.log(`'data' shape parse`);

        var ret = [];
        inputDictionary.forEach(element => {
            var temp = parseDatum(element);
            if (temp != null) { ret.push(temp); }
        });

        return ret;
    }

    var ret = [];

    console.log(`Processing data...`);

    if (jsonData == null || jsonData == ""){
        console.log(`No data found to process.`);
        return;
    }

    //console.log(`data: ${jsonData}`);
    if (jsonData.aircraft != null) {
        ret = parseAircraftsArray(jsonData.aircraft)
    }
    else if (jsonData.data != null) {
        ret = parseDataDictionary(jsonData.data)
    }
    else {
        console.log(`unknown data shape: ${jsonData}`);
        return;
    }
    
    const jsonString = JSON.stringify(ret, null, 2); 
    fs.writeFile(processedDataFilePath, jsonString, (err) => { 
        if (err) {
            //something went wrong, report error to console and return
            console.error('Error writing to processed data file:', err);
        }
        else {
            //if we get here, we were succesful in processing the data and writing it to the file
            console.log(`Data successfully written to ${processedDataFilePath}`);
        }
    });
}

function degreesToRadians(degrees) {
  return degrees * (Math.PI / 180);
}

function radiansToDegrees(radians) {
    return radians * (180 / Math.PI);
}

function calculate_distance(lat1, lon1, lat2, lon2) {
    //"""Calculates the distance in miles between two coordinates using the Haversine formula."""
    
    var R = 3958.8  // Radius of the Earth in miles

    var lat1r = degreesToRadians(lat1);
    var lon1r = degreesToRadians(lon1);
    var lat2r = degreesToRadians(lat2);
    var lon2r = degreesToRadians(lon2);

    var dlonr = lon2r - lon1r;
    var dlatr = lat2r - lat1r;

    var a = Math.sin(dlatr / 2)**2 + Math.cos(lat1r) * Math.cos(lat2r) * Math.sin(dlonr / 2)**2;
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    var distance = R * c;
    return distance;
}

function get_bearing(lat1, lon1, lat2, lon2) {
    //"""Calculates the initial bearing (azimuth) from point 1 to point 2 in degrees."""

    var lat1_rad = degreesToRadians(lat1);
    var lon1_rad = degreesToRadians(lon1);
    var lat2_rad = degreesToRadians(lat2);
    var lon2_rad = degreesToRadians(lon2);

    var dLon = lon2_rad - lon1_rad;

    var y = Math.sin(dLon) * Math.cos(lat2_rad)
    var x = Math.cos(lat1_rad) * Math.sin(lat2_rad) - Math.sin(lat1_rad) * Math.cos(lat2_rad) * Math.cos(dLon)

    var bearing_rad = Math.atan2(y, x)
    return (radiansToDegrees(bearing_rad) + 360) % 360
}

function get_direction_from_bearing(bearing) {
    //"""Converts a bearing in degrees to an abbreviated cardinal/ordinal direction."""
    if (bearing == null || bearing == "") { return ""; }

    var bearingRet = parseInt(bearing + 0.5) % 360;

    switch (true) {
        case 22.5 <= bearing < 67.5:
            return "NE";
        case 67.5 <= bearing < 112.5:
            return "E";
        case 112.5 <= bearing < 157.5:
            return "SE";
        case 157.5 <= bearing < 202.5:
            return "S";
        case 202.5 <= bearing < 247.5:
            return "SW";
        case 247.5 <= bearing < 292.5:
            return "W";
        case 292.5 <= bearing < 337.5:
            return "NW";
        default: 
            return "N";
    }
}

function interpretTrack(potential_track) {
    function isNumber(n) {
        try {
            let i = parseInt(n);
            return true;
        } catch (e) {
            return false;
        }
    }

    if (isNumber(potential_track)) {
        var track_num = parseInt(potential_track) % 360;
        switch (true) {
            case (track_num >= 338 || track_num < 23): 
                return "North";
            case 23 <= track_num < 68: 
                return "Northeast";
            case 68 <= track_num < 113: 
                return "East";
            case 113 <= track_num < 158: 
                return "Southeast";
            case 158 <= track_num < 203: 
                return "South";
            case 203 <= track_num < 248: 
                return "Southwest";
            case 248 <= track_num < 293: 
                return "West";
            case 293 <= track_num < 338: 
                return "Northwest";
            default: 
                return track_num.toString();
        }
    }
    else {
        return `N/A`
    }
}

function lookupAircraftType(aircraft_type) {
    var aircraft_type_desc = aircraft_type;
    
    if (aircraft_type == "B38M")
        aircraft_type_desc = "Boeing 737 MAX 8";
    else if (aircraft_type == "PA28")
        aircraft_type_desc = "Piper Cherokee"; // More general
    else if (aircraft_type == "J3")
        aircraft_type_desc = "Piper Cub";
    else if (aircraft_type == "C152")
        aircraft_type_desc = "Cessna 152";
    else if (aircraft_type == "C172")
        aircraft_type_desc = "Cessna 172 Skyhawk";
    else if (aircraft_type == "BE20")
        aircraft_type_desc = "Beechcraft King Air";
    else if (aircraft_type == "E75L")
        aircraft_type_desc = "Embraer E175";
    else if (aircraft_type == "EC20")
        aircraft_type_desc = "Eurocopter EC120";
    else if (aircraft_type == "C208")
        aircraft_type_desc = "Cessna 208 Caravan";
    else if (aircraft_type == "B737")
        aircraft_type_desc = "Boeing 737";
    else if (aircraft_type == "A21N")
        aircraft_type_desc = "Airbus A321neo";
    else if (aircraft_type == "B772")
        aircraft_type_desc = "Boeing 777";
    else if (aircraft_type == "P32R")
        aircraft_type_desc = "Piper Saratoga";
    else if (aircraft_type == "BT36")
        aircraft_type_desc = "Pilatus PC-6 Porter";
    else if (aircraft_type == "C150")
        aircraft_type_desc = "Cessna 150";
    else if (aircraft_type == "GLST")
        aircraft_type_desc = "Gulfstream Aerospace"; // General
    else if (aircraft_type == "T210")
        aircraft_type_desc = "Cessna 210 Centurion";
    else if (aircraft_type == "AS50")
        aircraft_type_desc = "Eurocopter AS50"; // General
    else if (aircraft_type == "E550")
        aircraft_type_desc = "Embraer Phenom 300";
    else if (aircraft_type == "GLEX")
        aircraft_type_desc = "Bombardier Global Express";
    else if (aircraft_type == "PA34")
        aircraft_type_desc = "Piper Seneca";
    else if (aircraft_type == "DA40")
        aircraft_type_desc = "Diamond DA40";
    else if (aircraft_type == "S22T")
        aircraft_type_desc = "Cirrus SR22T";
    else if (aircraft_type == "PC24")
        aircraft_type_desc = "Pilatus PC-24";
    else if (aircraft_type == "R44")
        aircraft_type_desc = "Robinson R44";
    else if (aircraft_type == "A319")
        aircraft_type_desc = "Airbus A319";
    else if (aircraft_type == "C750")
        aircraft_type_desc = "Cessna Citation X";
    else if (aircraft_type == "K35R")
        aircraft_type_desc = "KC-135 Stratotanker";
    else if (aircraft_type == "EC30")
        aircraft_type_desc = "Eurocopter EC130";
    else if (aircraft_type == "PC12")
        aircraft_type_desc = "Pilatus PC-12";
    else if (aircraft_type == "BE36")
        aircraft_type_desc = "Beechcraft Bonanza";
    else if (aircraft_type == "C310")
        aircraft_type_desc = "Cessna 310";
    else if (aircraft_type == "M20P")
        aircraft_type_desc = "Mooney M20";
    else if (aircraft_type == "C182")
        aircraft_type_desc = "Cessna 182 Skylane";
    else if (aircraft_type == "EV97")
        aircraft_type_desc = "EV-97 Eurostar";
    else if (aircraft_type == "PA32")
        aircraft_type_desc = "Piper PA-32 Cherokee";
    else if (aircraft_type == "GALX")
        aircraft_type_desc = "Gulfstream G650/G700";
    else if (aircraft_type == "B739")
        aircraft_type_desc = "Boeing 737-900";
    else if (aircraft_type == "B738")
        aircraft_type_desc = "Boeing 737-800";
    else if (aircraft_type == "A20N")
        aircraft_type_desc = "Airbus A320neo";
    else if (aircraft_type == "COZY")
        aircraft_type_desc = "Rutan Cozy";
    else if (aircraft_type == "B77W")
        aircraft_type_desc = "Boeing 777-300ER";
    else if (aircraft_type == "C206")
        aircraft_type_desc = "Cessna 206 Stationair";
    else if (aircraft_type == "J328")
        aircraft_type_desc = "Fairchild 328JET";
    else if (aircraft_type == "GLF4")
        aircraft_type_desc = "Gulfstream IV";
    else if (aircraft_type == "S2T")
        aircraft_type_desc = "Grumman S-2 Tracker";
    else if (aircraft_type == "V10")
        aircraft_type_desc = "Valmet L-70 Vinka";
    else if (aircraft_type == "E295")
        aircraft_type_desc = "Embraer E195-E2";
    else if (aircraft_type == "AA5")
        aircraft_type_desc = "Grumman AA-5";
    else if (aircraft_type == "A321")
        aircraft_type_desc = "Airbus A321";
    else if (aircraft_type == "C17")
        aircraft_type_desc = "C-17 Globemaster III";
    else if (aircraft_type == "B06")
        aircraft_type_desc = "Bell 206 JetRanger";
    else if (aircraft_type == "MM16")
        aircraft_type_desc = "Mitsubishi MU-2";

    return aircraft_type_desc;
}

function getISODateLocal() {
    const currentDate = new Date();

    // Get timezone offset in minutes and convert it to +/-hh:mm format
    const timezoneOffset = -currentDate.getTimezoneOffset();
    const offsetSign = timezoneOffset >= 0 ? '+' : '-';
    const offsetHours = String(Math.floor(Math.abs(timezoneOffset / 60))).padStart(2, '0');
    const offsetMinutes = String(Math.abs(timezoneOffset % 60)).padStart(2, '0');

    // Construct the ISO 8601 string with local time and timezone offset
    const localIsoDateString =
    `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}` +
    `T${String(currentDate.getHours()).padStart(2, '0')}:${String(currentDate.getMinutes()).padStart(2, '0')}:${String(currentDate.getSeconds()).padStart(2, '0')}` +
    `${offsetSign}${offsetHours}:${offsetMinutes}`;

    return localIsoDateString;
}

function isInTimeframe() {
    const now = new Date(); // Current time
    const startTime = new Date();
    startTime.setHours(timeframe_startHour, 0, 0); // Set to 12:00 PM today
    const endTime = new Date();
    endTime.setHours(timeframe_endHour, 0, 0); 

    // Adjust end time to the next day if it's earlier than the start time
    if (endTime.getTime() < startTime.getTime()) {
        endTime.setDate(endTime.getDate() + 1);
    }

    // Check if current time is within the range
    if (now.getTime() >= startTime.getTime() && now.getTime() <= endTime.getTime()) {
        console.log("Current time is within the specified range.");
        return true;
    } else {
        console.log("Current time is outside the specified range.");
        return false;
    }
}

function tryGetString(str, defaultVal) {
    if (str != null) {
        if (str != "") {
            return str;
        }
    }
    return defaultVal;
}

function tryGetNum(str, defaultVal) {
    if (str != null) {
        if (str != "") {
            return str;
        }
    }
    return defaultVal;
}