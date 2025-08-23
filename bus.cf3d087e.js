
!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:{},n=(new Error).stack;n&&(e._sentryDebugIds=e._sentryDebugIds||{},e._sentryDebugIds[n]="8f560a09-c475-589a-bbf9-19e04001ba6e")}catch(e){}}();
var e,r,t,n;r={},t={},null==(n=(e=globalThis).parcelRequirece9f)&&((n=function(e){if(e in r)return r[e].exports;if(e in t){var n=t[e];delete t[e];var o={id:e,exports:{}};return r[e]=o,n.call(o.exports,o,o.exports),o.exports}var i=Error("Cannot find module '"+e+"'");throw i.code="MODULE_NOT_FOUND",i}).register=function(e,r){t[e]=r},e.parcelRequirece9f=n),(0,n.register)("hFKVh",function(e,r){chrome.runtime.onMessage.addListener((e,r,t)=>{2==e.script_ver&&document.dispatchEvent(new CustomEvent("fromBus",{detail:e}))}),document.addEventListener("fromContent",e=>{chrome.runtime.sendMessage(e.detail)})}),n("hFKVh");
//# sourceMappingURL=bus.cf3d087e.js.map

//# debugId=8f560a09-c475-589a-bbf9-19e04001ba6e
