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
  pollingIntervalSeconds: 20.
};



// this is our polling timer
let pollTimer = null;

// This function gets the battery voltage from local status ---------------
function get_battery_voltage() {
  const response = Shelly.getComponentStatus('voltmeter')

  const responseValid = typeof response !== "undefined" && hasProperty(response, 'xvoltage');

  // if the response has errors that contains 'read' it means that voltage is >= 50V
  if (responseValid === false) {
    return;
  }
  else {
  
  let batteryVoltageRaw = response.xvoltage;
  }

  console.log(Date.now(), 'Raw Battery Voltage:', batteryVoltageRaw);
}
// ------------------------------------------------------------------------

print(Date.now(), "Start Battery Voltage monitoring for LVDS ");


Shelly.addStatusHandler(function (status) {
  //check if the event source is a voltmeter
  //and if the id is 100. That will be our voltmeter:100
  //
  if (status.name === "voltmeter" && status.id === 100) {

    // This is of interest to us. Lets check if there are any errors
    if (status.errors.length > 0) {
      print("Raw battery voltage = ", batteryVoltageRaw);
    }
    else {
      // there are errors so it will return anyway
    }
  }
});