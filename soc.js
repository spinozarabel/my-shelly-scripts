// Copyright 2025 Madhu A
//
// Licensed under the MIT license
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

// Shelly is a Trademark of Allterco Robotics

// Shelly Script LVDS - Low Battery Voltage Disconnect for an Inverter - Battery system
// ver 3 28 Feb 2025
// This script monitors a shelly plus 1 device with an Addon that has an analog input.
// This analog input is configured as an ammeter with a FS of 100% corresponding to 10V.
// xpercent calculated value is configured to be the battery current in Amps.
// using a Hall effect sensor and an opamp with a gain of 4.7.
// The battery current is monitored and the accumulated SOC is calculated for a 300AH battery system.
// If the SOC goes below 60% the output switch of the ShellyPlus 1 is turned on.
// If the SOC goes above 62% the output switch of the ShellyPlus 1 is turned off.
//
let CONFIG = {

  // LVDS SOC threshold. If the battery SOC goes below this value LVDS is triggered
  lvdsSoc: 60.0,


  // LVDS recovery voltage threshold
  lvdsSocRecovery: 62.0,

  // timeout for http call
  httpTimeout: 10,
  
  // Shelly battery voltage device IP address
  shellyBatteryVoltageUrl: "http://192.168.33.7/rpc/Voltmeter.GetStatus?id=100",
  // URL to turnon the output switch of the ShellyPlus 1 of the Battery Voltage Sensor
  shellyOutputOnUrl:        "http://192.168.33.7/rpc/Switch.Set?id=0&on=true",
  // URL to turnoff the output switch of the ShellyPlus 1 of the Battery Voltage Sensor
  shellyOutputOffUrl:       "http://192.168.33.7/rpc/Switch.Set?id=0&on=false",
  // 
  shellySocNumberSetUrl:    "http://192.168.87.120/rpc/Number.Set?id=200&value=",
};

function process_main(status) {
  // get the battery current
  batteryCurrentNow = status.delta.xpercent;

  // if absolute value of the battery current is less than 1.6A, then set it to 0
  if (Math.abs(batteryCurrentNow) < 1.6) {
    batteryCurrentNow = 0;
  }

  // get the current timestep in seconds
  ts_now_secs = Math.floor(Date.now() / 1000);

  deltaSeconds = ts_now_secs - ts_past_secs;

  // script updates less than this may cause too many calls in process error due to async nature
  if (deltaSeconds <  10) {
    return;
  }

  // calculate the average current
  batteryCurrentAvg = (batteryCurrentPast + batteryCurrentNow) * 0.5;

  // calculate the delta charge in Ah
  deltaChargeAh = (batteryCurrentAvg * deltaSeconds) / 3600;

  // calculate the delta soc in percent
  deltaSocPercent = (deltaChargeAh / 300) * 100;  // battery capacity is 300Ah

  // Update the soc in percent as an accumulation
  socPercentNow += deltaSocPercent;

  // clamp to 100
  if (socPercentNow > 100) {
    socPercentNow = 100;
  }

  print("Battery Current: ", batteryCurrentAvg, "deltaSecs=", deltaSeconds, " SOC: ", Math.round(socPercentNow * 10) / 10);

  // move present to past
  batteryCurrentPast  = batteryCurrentNow;
  ts_past_secs        = ts_now_secs;

  // if the SOC is less than 60% then turn on the output switch
  if (lvdsTriggered === false &&  socPercentNow < CONFIG.lvdsSoc) {
    // turn on the output switch
    Shelly.call("http.get",
      { url: CONFIG.shellyOutputOnUrl, timeout: CONFIG.httpTimeout },
      fn_turnGridOn
    );
  }

  // if the SOC is greater than 62% then turn off the output switch
  if (lvdsReleased === false &&  socPercentNow > CONFIG.lvdsSocRecovery) {
    // turn off the output switch
    Shelly.call("http.get",
      { url: CONFIG.shellyOutputOffUrl, timeout: CONFIG.httpTimeout }, 
      fn_turnGridOff
    );
  }

  // write the soc value to virtual component of Shelly Grid PRO 3EM device
  // Setting values of virtual components is only async operation
  let shellySocNumberSetUrl = CONFIG.shellySocNumberSetUrl + Math.round(socPercentNow * 100) / 100;
  
  Shelly.call("http.get", { url: shellySocNumberSetUrl, timeout: CONFIG.httpTimeout }, function(result) {
    // do something here if you wish
  });
}


// Go OFF-GRID by switching Remote Entry to Open Active to prohibit the Transfer Relay
function fn_turnGridOff(response, error_code, error_message) {
  if (error_code === 0) {
              
    lvdsTriggered = false;
    lvdsReleased  = true;
    print(Date.now(), "LVDS Released - SOC: ", socPercentNow);
  }
}

// Go ON-GRID by switching Remote Entry to Closed Inactive to not prohibit the Transfer Relay
function fn_turnGridOn(response, error_code, error_message) {
  if (error_code === 0) {
            
    lvdsTriggered = true;
    lvdsReleased  = false;
    print(Date.now(), "LVDS Triggered - SOC: ", socPercentNow);
  }
}




// Start the script
// These are global variables
let batteryVoltage            = 0;
let batteryCurrent            = 0;
let batteryIsCharging         = false;
let batteryIsDischarging      = false;
let ts_now_secs               = Math.floor(Date.now() / 1000)
let ts_past_secs              = Math.floor(Date.now() / 1000)
let batteryCurrentPast        = 0;
let batteryCurrentNow         = 0;
let batteryCurrentAvg         = 0;
let deltaChargeAh             = 0;
let deltaSocPercent           = 0;
let socPercentNow             = 100;     // SOC value at beginning of script
let lvdsTriggered             = false;
let lvdsReleased              = false;

print(Date.now(), "Start Battery Voltage monitoring for LVDS ");

// Start the script by setting the timer. When the timer goes off, the process_main function is called.
// The process_main function will then set the timer again.

// timer based event handler
Shelly.addStatusHandler(function (status) {

  //is the component the analog add-on?
  if(status.name !== "input") return;

  //is it the one with id 100
  if(status.id !==100) return;

  //does it have a delta.source property
  if(typeof status.delta.xpercent === "undefined") return;

  // call the main function
  process_main(status);
});