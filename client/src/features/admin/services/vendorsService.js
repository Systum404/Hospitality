const configured=import.meta.env.VITE_API_BASE_URL?.trim();const origin=configured?configured.replace(/\/+$/,""):import.meta.env.DEV?`${window.location.protocol}//${window.location.hostname}:4000`:"";
export class VendorsRequestError extends Error{constructor(message,{status=0,code="VENDOR_REQUEST_FAILED"}={}){super(message);this.status=status;this.code=code}}
async function request(hotelId,path="",options={}){const response=await fetch(`${origin}/api/hotels/${encodeURIComponent(hotelId)}/vendors${path}`,{credentials:"include",...options,headers:{...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})}});const payload=await response.json().catch(()=>null);if(!response.ok)throw new VendorsRequestError(payload?.error?.message||"Vendor request failed.",{status:response.status,code:payload?.error?.code});return payload.data}
export const getVendors=(hotelId,options={})=>request(hotelId,"",options).then(({vendors})=>vendors);
export const createVendor=(hotelId,input)=>request(hotelId,"",{method:"POST",body:JSON.stringify(input)}).then(({vendor})=>vendor);
export const updateVendor=(hotelId,id,input)=>request(hotelId,`/${encodeURIComponent(id)}`,{method:"PATCH",body:JSON.stringify(input)}).then(({vendor})=>vendor);
export const updateVendorStatus=(hotelId,id,is_active)=>request(hotelId,`/${encodeURIComponent(id)}/status`,{method:"PATCH",body:JSON.stringify({is_active})}).then(({vendor})=>vendor);
export const deleteVendor=(hotelId,id)=>request(hotelId,`/${encodeURIComponent(id)}`,{method:"DELETE"}).then(({vendor})=>vendor);
