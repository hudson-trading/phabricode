const fetch = require('node-fetch');
export class RestApi {
	static async post (baseurl, api, key, params) {
	let data = `api.token=${key}`;
	for (const paramKey in params) {
	  data += `&${paramKey}=${params[paramKey]}`
	}
  
	const url = baseurl + (baseurl.endsWith('/') ? '' : '/') + api;
  
	const response = await fetch(url, {
	  method: 'POST',
	  cache: 'no-cache',
	  credentials: 'omit',
	  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
	  referrerPolicy: 'no-referrer',
	  body: data,
	});
	return await response.json();
  }
}