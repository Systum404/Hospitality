import { AppError } from "../middleware/errorHandler.js";
import { getCustomer, searchCustomers } from "../services/customerService.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid=(message,code)=>{throw new AppError(message,{code,statusCode:400});};

export function validateCustomerHotelId(req,_res,next){try{if(!UUID.test(req.params.hotelId||""))invalid("hotelId must be a valid UUID.","INVALID_HOTEL_ID");next();}catch(error){next(error);}}

export async function search(req,res,next){try{if(Object.keys(req.query).some(key=>key!=="phone"))invalid("Only phone search is supported.","INVALID_CUSTOMER_SEARCH");if(typeof req.query.phone!=="string"||!req.query.phone.trim()||req.query.phone.trim().length>20)invalid("phone must be a non-empty string of at most 20 characters.","INVALID_CUSTOMER_PHONE");res.json({status:"success",data:{customers:await searchCustomers(req.params.hotelId,req.query.phone.trim())}});}catch(error){next(error);}}

export async function retrieve(req,res,next){try{if(!UUID.test(req.params.customerId||""))invalid("customerId must be a valid UUID.","INVALID_CUSTOMER_ID");res.json({status:"success",data:{customer:await getCustomer(req.params.hotelId,req.params.customerId)}});}catch(error){next(error);}}
