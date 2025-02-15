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
  lvdsIntervalMinutes: 1,
  // LVDS Voltage threshold. If the battery voltage goes below this value LVDS is triggere
  lvdsVoltage: 47.8,
  // number of minutes for the LVDS recovery window.
  lvdsRecoveryIntervalMinutes: 3,
  // LVDS recovery voltage threshold
  lvdsRecoveryVoltage: 48.3,
  // polling interval in seconds
  pollingIntervalSeconds: 20,
  // timeout for http call
  httpTimeout: 10,
};



// this is our polling timer
let pollTimer = null;

// generic function that reads a parameter with http get.
// p_url: address of device to read
function fn_shelly_call(p_url) {
  Shelly.call(
    "http.get",
    { url: p_url, timeout: CONFIG.httpTimeout },
    function (response, error_code, error_message) {
      if (error_code != 0) {
        print("Failed to fetch, error(" + error_code + ") " + error_message + ' - url: ' + p_url);
        return 0;
      } else {
        if (response === undefined || response === null) {
          print("ERROR - response undefined or NULL");
          return 0;
        } else {
            let responseData = JSON.parse(response.body);
            let batterVoltageRaw = responseData.xvoltage;
            if (batterVoltageRaw == undefined || batterVoltageRaw === null)  {
              print("ERROR - response error code: " + responseData.error);
              return;
            }
            // we have a valid measurement of the raw battery voltage at its terminals
            print (Date.now(), "Raw Battery Voltage: ", batterVoltageRaw);

            Shelly.call("Input.GetStatus",{ id:100 },
              function(result, err_code, err_message, batterVoltageRaw) {
                  if (err_code === 0) {
                    const battery_current = result['xpercent'];
                      console.log("battery current", battery_current);
                      
                  } else {
                      console.log("Error:", err_message);
                  }
              }
          );

            
            }
        }
  });
}
    


// main function that is called periodically
function process_main() {
  const p_url_shellyplus1_battery_sensor = "http://192.168.33.7/rpc/Voltmeter.GetStatus?id=100";

  fn_shelly_call(p_url_shellyplus1_battery_sensor);

}
  

print(Date.now(), "Start Battery Voltage monitoring for LVDS ");

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
  pingTimer = Timer.set(CONFIG.retryIntervalSeconds * 1000, true, process_main);
});