// Copyright 2025 Madhu A
//
// Licensed under the MIT license
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Shelly is a Trademark of Allterco Robotics

// Shelly Script LVDS - Low Battery Voltage Disconnect for an Inverter - Battery system
//
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
  lvdsTimerCount: 6, // count of 6 is an interval of 3 minutes as each count is one timer interval
  // LVDS Voltage threshold. If the battery voltage goes below this value LVDS is triggere
  lvdsVoltage: 49.5,
  // number of minutes for the LVDS recovery window.
  lvdsRecoveryTimerCOunt: 10,  // count of 10 is an interval of 5 minutes
  // LVDS recovery voltage threshold
  lvdsRecoveryVoltage: 49.8,
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

// Function to control the LVDS
function fn_lvds(batteryVoltage) {
  // if the battery voltaage is reasonable and less than LVDS threshold
  if (batteryVoltage < CONFIG.lvdsVoltage && batteryVoltage > 40) {
    lvdsTimerCounter++;
    if (lvdsTimerCounter >= CONFIG.lvdsTimerCount) {
      // Turn on the output switch of the ShellyPlus 1 of the Battery Voltage Sensor
      Shelly.call("http.get",
        { url: CONFIG.shellyOutputOnUrl, timeout: CONFIG.httpTimeout },
        function (response, error_code, error_message) {
        if (error_code === 0) {
          print(Date.now(), "LVDS Triggered - Battery Voltage: ", batteryVoltage);
          // reset the lvds counters
          lvdsTimerCounter = 0;
        }
      });
    } else if (batteryVoltage > CONFIG.lvdsRecoveryVoltage) {
      lvdsRecoveryTimerCounter++;
      if (lvdsRecoveryTimerCounter >= CONFIG.lvdsRecoveryTimerCOunt) {
        // Turn off the output switch
        Shelly.call("http.get",
          { url: CONFIG.shellyOutputOffUrl, timeout: CONFIG.httpTimeout },
          function (response, error_code, error_message) {
          if (error_code === 0) {
            print(Date.now(), "LVDS Released - Battery Voltage: ", batteryVoltage);
            // Reset the counters
            lvdsTimerCounter = 0;
            lvdsRecoveryTimerCounter = 0;
          }
        });
      }
    } else {
      // Reset the counters
      lvdsTimerCounter = 0;
      lvdsRecoveryTimerCounter = 0;
    }
  }
}


// Function to process the main logic
function process_main() {
  const shellyBatteryVoltageUrl = CONFIG.shellyBatteryVoltageUrl;

  Shelly.call(
    "http.get",
    { url: shellyBatteryVoltageUrl, timeout: CONFIG.httpTimeout },
    function (response, error_code, error_message) {
      if (error_code === 0) {
        // we have a valid response.
        let responseData      = JSON.parse(response.body);
        let batterVoltageRaw  = responseData.xvoltage;
        if (batterVoltageRaw === undefined || batterVoltageRaw === null)  {
          // Bad data, return
          print("ERROR - voltage is undefined or NULL" );
          return;
        }

        // we have a valid measurement of the raw battery voltage at its terminals
        // print (Date.now(), "Raw Battery Voltage: ", batterVoltageRaw);
        Shelly.call("Input.GetStatus",{ id:100 },
          function(result, err_code, err_message) {
          if (err_code === 0) {
            // we have a valid current measurement
            const battery_current = result['xpercent'];
            // console.log("battery current", battery_current);

            // Calculate the IR compensated Battery Voltage
            // battery current is +ve when charging and -ve when discharging
            // Compensated battery voltage is higher while discharging and lower while charging
            $batteryVoltageCompensated = batterVoltageRaw - (battery_current * CONFIG.rInt);
            print('VbatRaw: ', batterVoltageRaw, ' VbatComp: ', $batteryVoltageCompensated);

            // do something with the compensated battery voltage
            fn_lvds($batteryVoltageCompensated);

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
// set the lvds timer counter to 0
let lvdsTimerCounter = 0;
let lvdsRecoveryTimerCounter = 0;

print(Date.now(), "Start Battery Voltage monitoring for LVDS ");

// Start the script by setting the timer. When the timer goes off, the process_main function is called.
// The process_main function will then set the timer again.
pingTimer = Timer.set(CONFIG.pollingIntervalSeconds * 1000, true, process_main);

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