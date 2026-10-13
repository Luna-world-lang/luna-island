export function kstParts(now=new Date()){const d=new Date(now.getTime()+9*3600000);return {hour:d.getUTCHours(),minute:d.getUTCMinutes()};}
export function scheduledAction(now=new Date()){const {hour,minute}=kstParts(now);if(hour===5&&minute<45)return 'pause';if(hour>=6&&hour<9)return 'restore';return 'none';}
export function inMaintenance(now=new Date()){return kstParts(now).hour===5;}
