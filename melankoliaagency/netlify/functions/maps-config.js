const{json}=require('./_firebase');exports.handler=async e=>json(e.httpMethod==='OPTIONS'?204:200,{success:true,apiKey:process.env.GOOGLE_MAPS_API_KEY||''});
