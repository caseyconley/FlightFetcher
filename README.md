# Flight Fetcher

This is a simple Node JS application written using Express that will periodically make requests to Flight Raider Rapid API for flight data around a 15 mi x 15 mi square area above a specified altitude threshold. When data is retrieved, it is saved locally. The server will also process the data into a format that is digestable by client applications to display bearing, speed, and other information about the flight and save that locally as well. Requests made to this server will read the stored data and return it as-is, along with a timestamp representing the current time. 

## How to Start

To run server locally:

```
node app.js
```

To run the server with optional command line arguments (ordered):

```
node app.js [startTimeHourInt] [endTimeHourInt] [altitudeThresholdInt] [requestIntervalInSeconds]
```

## Usage

```
GET /flights
```
Returns stored unprocessed flight data, and includes an additional field `timestamp` representing the server's current local date and time.

```
GET /processedflights
```
Returns stored processed flight data, and includes an additional field `timestamp` representing the server's current local date and time.

## Credits
Credit to Daniel Conley for developing the functions that process the flight data into a digestable format, and for the math functions that calculate altitude, bearing, and speed for the flights as part of that processed output.
