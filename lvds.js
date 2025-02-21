// Copyright 2025 Madhu A
//
// Licensed under the MIT license
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

// Shelly is a Trademark of Allterco Robotics

// Shelly Script LVDS - Low Battery Voltage Disconnect for an Inverter - Battery system
// ver 2 17 Feb 2025
// This script monitors a shelly plus 1 device with an Addon that has an analog input.
// This analog input is configured as a Voltmeter with a FS of 10V.
// The voltage of the lithium battery is in the range of 46 - 54V.
// A divide by 5 is used to bring this down for our 0-10V range.
// Another Shelly plus 1 with an add on measures the battery current
// using a Hall effect sensor and an opamp with a gain of 4.7.
// The battery voltage is periodically sampled and so is the battery current of the other device.
// The battery voltage is calculated including an assumed IR drop.
// When the voltage goes below a set limit for more than the set time, the output switch is closed.
// WHen the voltage crosses a set recovery voltage for more than a set time, the output switch is released.
//
let CONFIG = {
  // number of minutes for the LVDS window
  lvdsTimerCount: 3, // count of 3 is an interval of 1.5 minutes as each count is 30s
  // LVDS Voltage threshold. If the battery voltage goes below this value LVDS is triggere
  lvdsVoltage: 49.5,
  // number of minutes for the LVDS recovery window.
  lvdsRecoveryTimerCOunt: 6,  // count of 6 is an interval of 3 minutes
  // LVDS recovery voltage threshold
  lvdsRecoveryVoltage: 49.7,
  // polling interval in seconds
  pollingIntervalSeconds: 30,
  // timeout for http call
  httpTimeout: 10,
  // Battery Internal resistance in Ohms
  rInt: 0.035,
  // Shelly battery voltage device IP address
  shellyBatteryVoltageUrl: "http://192.168.33.7/rpc/Voltmeter.GetStatus?id=100",
  // URL to turnon the output switch of the ShellyPlus 1 of the Battery Voltage Sensor
  shellyOutputOnUrl:        "http://192.168.33.7/rpc/Switch.Set?id=0&on=true",
  // URL to turnoff the output switch of the ShellyPlus 1 of the Battery Voltage Sensor
  shellyOutputOffUrl:       "http://192.168.33.7/rpc/Switch.Set?id=0&on=false",
};

// Function to control the LVDS onset and release
function fn_lvds(batteryVoltage, batteryCurrent, batteryIsDischarging) {
 
  switch (true) {
    // LVDS
    case (batteryVoltage < CONFIG.lvdsVoltage && batteryVoltage > 40 && batteryIsDischarging):
      // LVDS onset - need to sustain over the required interval
      lvdsTimerCounter++;
      print(Date.now(), "LVDS counter incremented to: ", lvdsTimerCounter);
      if (lvdsTimerCounter >= CONFIG.lvdsTimerCount) {
        // Turn on the output switch of the ShellyPlus 1 of the Battery Voltage Sensor
        Shelly.call("http.get",
          { url: CONFIG.shellyOutputOnUrl, timeout: CONFIG.httpTimeout },
          function (response, error_code, error_message) {
          if (error_code === 0) {
            
            lvdsTriggered = true;
            lvdsReleased  = false;
            print(Date.now(), "LVDS Triggered - Battery Voltage: ", batteryVoltage);
            // reset the lvds counters
            lvdsTimerCounter = 0;

          }
        }); // end of the Shelly.call function
      }
      break;
    
    // LVDS release
    case (batteryVoltage > CONFIG.lvdsRecoveryVoltage && lvdsReleased === false && ! batteryIsDischarging):
      // LVDS release onset - need to sustain over the required interval
      lvdsRecoveryTimerCounter++;
      print(Date.now(), "LVDS release counter incremented to: ", lvdsRecoveryTimerCounter);
      if (lvdsRecoveryTimerCounter >= CONFIG.lvdsRecoveryTimerCOunt) {
        // Turn off the output switch
        Shelly.call("http.get",
          { url: CONFIG.shellyOutputOffUrl, timeout: CONFIG.httpTimeout },
          function (response, error_code, error_message) {
            if (error_code === 0) {
              
              lvdsTriggered = false;
              lvdsReleased  = true;

              print(Date.now(), "LVDS Released - Battery Voltage: ", batteryVoltage);

              // Reset the counters
              lvdsTimerCounter = 0;
              lvdsRecoveryTimerCounter = 0;
            }
          }
        );
      }
      break;

    // not LVDS and not LVDS release so reset the counters
    default:
      lvdsTimerCounter = 0;
      lvdsRecoveryTimerCounter = 0;
      break;

  } // end of switch
}   // end of function fn_lvds



// Function to process the main logic
function process_main() {
  const shellyBatteryVoltageUrl = CONFIG.shellyBatteryVoltageUrl;

  // measure the battery voltage using the shellyplus1 with addon
  // an error in measurement usually implies that reading os out of range so > 50V
  Shelly.call(
    "http.get",
    { url: shellyBatteryVoltageUrl, timeout: CONFIG.httpTimeout },
    function (response, error_code, error_message) {
      if (error_code === 0) {
        // we have a valid response.
        let responseData      = JSON.parse(response.body);
        let batterVoltageRaw  = responseData.xvoltage;
        if (batterVoltageRaw === undefined || batterVoltageRaw === null)  {
          // Bad data, return after restting the lvds counters
          lvdsTimerCounter = 0;
          lvdsRecoveryTimerCounter = 0;
          print("ERROR - voltage is undefined or NULL" );
          return;
        }

        // we have a valid measurement of the raw battery voltage at its terminals
        // So lets get a local measurement of the current flowing in the battery
        Shelly.call("Input.GetStatus",{ id:100 },
          function(result, err_code, err_message) {
          if (err_code === 0) {
            // we have a valid current measurement
            const battery_current = result['xpercent'];
            // console.log("battery current", battery_current);

            // Calculate the IR compensated Battery Voltage
            // battery current is +ve when charging and -ve when discharging
            // Compensated battery voltage is higher while discharging and lower while charging
            // However, sometimes the old battery voltage reading is given even though
            // it has gone past FS due to charging.
            // So we need to check if the battery current is charging or discharging
            const batteryIsCharging     = battery_current >= 0  ? true : false;
            const batteryIsDischarging  = battery_current < 0   ? true : false;
            if (batteryIsCharging) {
              // battery is charging and likely there is no danger of LVDS
              $batteryVoltageCompensated = batterVoltageRaw;
            } else if (batteryIsDischarging) {
              // battery is discharging and there is a danger of LVDS
              $batteryVoltageCompensated = batterVoltageRaw - (battery_current * CONFIG.rInt);
            }
            
            print('VbatRaw: ', batterVoltageRaw, ' VbatComp: ', $batteryVoltageCompensated, ' Ibat: ', battery_current);

            // do something with the compensated battery voltage
            fn_lvds($batteryVoltageCompensated, battery_current, batteryIsDischarging);

          } else {
              console.log("Error:", err_message);
              return;
          }
        });
      } else {
          // we have errors in battery voltage measurement
          print("Failed to fetch, error(" + error_code + ") " + error_message + ' - url: ' + shellyBatteryVoltageUrl);
          return;
        } 
    });
}
    

// Start the script
// set the lvds timer counters to 0. These are global variables
let lvdsTimerCounter          = 0;
let lvdsRecoveryTimerCounter  = 0;
let lvdsTriggered             = false;
let lvdsReleased              = false;
let pingTimer                 = null;

print(Date.now(), "Start Battery Voltage monitoring for LVDS ");

// Start the script by setting the timer. When the timer goes off, the process_main function is called.
// The process_main function will then set the timer again.
pingTimer = Timer.set(CONFIG.pollingIntervalSeconds * 1000, true, process_main);

// timer based event handler
Shelly.addStatusHandler(function (status) {
  //is the component a switch
  if(status.name !== "switch") return;

  //is it the one with id 0
  if(status.id !== 0) return;

  //does it have a delta.source property
  if(typeof status.delta.source === "undefined") return;

  //is the source a timer
  if(status.delta.source !== "timer") return;

  //is it turned on
  if(status.delta.output !== true) return;

  Timer.clear(pingTimer);

  // start the loop to ping the endpoints again
  pingTimer = Timer.set(CONFIG.pollingIntervalSeconds * 1000, true, process_main);
});