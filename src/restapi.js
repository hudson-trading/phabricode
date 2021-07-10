const fetch = require('node-fetch');
const AbortController = require('abort-controller');
export class RestApi {
	/*
	Unfortunately we need to handle our own timeout
	c.f. https://github.com/node-fetch/node-fetch#request-cancellation-with-abortsignal

	For simplicity we're hardcoding this to 3s - if needs be it could be exposed as a parameter
	*/
	static timeoutInSeconds = 3;
	static async post (baseurl, api, key, params) {
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort();
		}, this.timeoutInSeconds*1000); // this is in ms


		let data = `api.token=${key}`;
		for (const paramKey in params) {
			data += `&${paramKey}=${params[paramKey]}`
		}
	
		const url = baseurl + (baseurl.endsWith('/') ? '' : '/') + api;
		try {
			const response = await fetch(url, {
				method: 'POST',
				cache: 'no-cache',
				credentials: 'omit',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				referrerPolicy: 'no-referrer',
				body: data,
				signal: controller.signal
			      });
			return await response.json();
		} catch (error) {
			if (error.name === "AbortError") {
				console.log(`Request was aborted due to exceeding a timeout of ${this.timeoutInSeconds} seconds`);
			}
		} finally {
			clearTimeout(timeout);
		}
	  }
}