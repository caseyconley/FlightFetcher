@echo on
:: Define variables
set START_TIME_HOUR="12"
set END_TIME_HOUR="20"
set ALTITUDE_THRESHOLD_FEET="750"
set API_REQUEST_INTERVAL_SECONDS="90"

:: Pass variables as arguments to the Node.js application
node app.js %START_TIME_HOUR% %END_TIME_HOUR% %ALTITUDE_THRESHOLD_FEET% %API_REQUEST_INTERVAL_SECONDS%
pause