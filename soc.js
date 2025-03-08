// Copyright 2025 Madhu A
//
// Licensed under the MIT license
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

// Shelly is a Trademark of Allterco Robotics

// Shelly Script LVDS - Low Battery Voltage Disconnect for an Inverter - Battery system
// ver 3.1 8 Mar 2025
// This script monitors a shelly plus 1 device with an Addon that has an analog input.
// This analog input is configured as an ammeter with a FS of 100% corresponding to 10V.
// xpercent calculated value is configured to be the battery current in Amps.
// using a Hall effect sensor and an opamp with a gain of 4.7.
// The battery current is monitored and the accumulated SOC is calculated for a 300AH battery system.
// If the SOC goes below 60% the output switch of the ShellyPlus 1 is turned on.
// If the SOC goes above 62% the output switch of the ShellyPlus 1 is turned off.
// MQTT is used to get SOC data from the local Linux computer via the remote MQTT broker
// such that the SOC's are synchonized. Should the rest of the system fail,
// This script will work standalone.
//
let CONFIG = {

  // LVDS SOC threshold. If the battery SOC goes below this value LVDS is triggered
  lvdsSoc: 60.0,

  // LVDS recovery voltage threshold
  lvdsSocRecovery: 62.0,

  // timeout for http call
  httpTimeout: 10,

  pollingIntervalSeconds: 20,
  
  // Shelly battery voltage device IP address
  shellyBatteryVoltageUrl: "http://192.168.33.7/rpc/Voltmeter.GetStatus?id=100",
  // URL to turnon the output switch of the ShellyPlus 1 of the Battery Voltage Sensor
  shellyOutputOnUrl:        "http://192.168.33.7/rpc/Switch.Set?id=0&on=true",
  // URL to turnoff the output switch of the ShellyPlus 1 of the Battery Voltage Sensor
  shellyOutputOffUrl:       "http://192.168.33.7/rpc/Switch.Set?id=0&on=false",
  // 
  shellySocNumberSetUrl:    "http://192.168.87.120/rpc/Number.Set?id=200&value=",
};

function process_main() {
  Shelly.call("Input.GetStatus", {id:100}, process_main_callback); 
}

function process_main_callback(response, error_code, error_message) {
  if (error_code === 0)
    {
      // no errors extract desired information
      batteryCurrentNow = response.xpercent;
      // if absolute value of the battery current is less than 1.6A, then set it to 0
      if (Math.abs(batteryCurrentNow) < 1.6) {
        batteryCurrentNow = 0;
      }

      // get the current timestep in seconds
      ts_now_secs = Math.floor(Date.now() / 1000);

      deltaSeconds = ts_now_secs - ts_past_secs;
      // calculate the average current
      batteryCurrentAvg = (batteryCurrentPast + batteryCurrentNow) * 0.5;

      // calculate the delta charge in Ah
      deltaChargeAh = (batteryCurrentAvg * deltaSeconds) / 3600;

      // calculate the delta soc in percent
      deltaSocPercent = (deltaChargeAh / 300) * 100;  // battery capacity is 300Ah

      // if the SOC update is too much ignore, probably error in current reading
      if (Math.abs(deltaSocPercent) > 1.0)
      {
        return;
      }

      // Update the soc in percent as an accumulation
      socPercentNow += deltaSocPercent;

      // clamp to 100
      if (socPercentNow > 100) {
        socPercentNow = 100;
      }

      print("Battery Current: ", batteryCurrentAvg, "deltaSoc=", deltaSocPercent, " SOC: ", Math.round(socPercentNow * 10) / 10);

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

      // write the soc value to script storage
      // kvsSet('socPercentNow', socPercentNow);
    }
    else
    {
      // errors in input.getstatus
      print("errors in input.getstatus call");
      return;
    }
}

// function to set a local variable (KVS)
function kvsSet(key, value) {
  Shelly.call(
      "KVS.Set",
      { "key": key, "value": value }
  );
}


function kvsGet(key) {
  Shelly.call(
      "KVS.Get", { "key": key }, 
      function(response, error_code, error_message) {
        if ( error_code === 0 ) {
          return response.value;
        }
        else {
          print ( "error in KVS.GET: ", error_message );
          return 100;
        }
      }
  );
}

// mqtt subscription
function mqttSubscribe()
{
  // check if MQTT is connected
  if (!MQTT.isConnected()) {
    print("MQTT is NOT connected, using default initial values for SOC");
    return;
  }

  let sub_topic = 'fb16/battery';
  MQTT.subscribe(sub_topic, mqttSubscriptioncallback);
}

function mqttSubscriptioncallback(topic, message)
{
  let message_dejsoned = JSON.parse(message);
  let soc_percentage_now = message_dejsoned.soc_percentage_now;

  if ( soc_percentage_now > 40 && soc_percentage_now < 101 ) {
   socPercentNow = soc_percentage_now;

    print ("MQTT soc NOW: ", soc_percentage_now);
  }
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
let lvdsTriggered             = false;
let lvdsReleased              = false;
let pollTimer                 = null;

let socPercentNow = 100;

mqttSubscribe();


print(Date.now(), "Start Battery Voltage monitoring for LVDS ");

// Start the script by setting the timer. When the timer goes off, the process_main function is called.
// The process_main function will then set the timer again.

pollTimer = Timer.set(CONFIG.pollingIntervalSeconds * 1000, true, process_main);
