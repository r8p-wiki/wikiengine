router.all(/^\/member\/signup$/, async function signupEmailScreen(req, res, next) {
	if(!['GET', 'POST'].includes(req.method)) return next();
	
	var desturl = req.query['redirect'];
	if(!desturl) desturl = '/';
	
	if(islogin(req)) { res.redirect(desturl); return; }
	
	if(userblocked(ip_check(req, true))) showError( 'permission_create_account' );
	
	var emailfilter = '';
	if(config.getString('wiki.email_filter_enabled', 'false') == 'true') {
		emailfilter = `
			<p>이메일 허용 목록이 활성화 되어 있습니다.<br />이메일 허용 목록에 존재하는 메일만 사용할 수 있습니다.</p>
			<ul class=wiki-list>
		`;
		for(var item of await curs.execute("select address from email_filters")) {
			emailfilter += '<li>' + item.address + '</li>';
		}
		emailfilter += '</ul>';
	}
	
	var bal = '';
	var error = null;
	
	if(hostconfig.disable_email) req.body['email'] = '';
	
	if(req.method == 'POST') do {
		var blockmsg = await ipblocked(ip_check(req, 1));
		if(blockmsg) break;
		if(!hostconfig.disable_email && (!req.body['email'] || req.body['email'].match(/[@]/g).length != 1)) {
			var invalidemail = 1;
			break;
		}
		var data = await curs.execute("select email from account_creation where email = ?", [req.body['email']]);
		if(!hostconfig.disable_email && data.length) {
			var duplicate = 1;
			break;
		}
		var data = await curs.execute("select value from user_settings where key = 'email' and value = ?", [req.body['email']]);
		if(!hostconfig.disable_email && data.length) {
			var userduplicate = 1;
			break;
		}
		if(emailfilter) {
			var data = await curs.execute("select address from email_filters where address = ?", [req.body['email'].split('@')[1]]);
			if(!hostconfig.disable_email && !data.length) {
				var filteredemail = 1;
				break;
			}
		}
	} while(0);
	
	var content = `
		${req.method == 'POST' && !error && filteredemail ? (error = err('alert', { msg: '이메일 허용 목록에 있는 이메일이 아닙니다.' })) : ''}
		${req.method == 'POST' && !error && blockmsg ? (error = err('alert', { msg: blockmsg })) : ''}
		
		<form method=post class=signup-form>
			<div class=form-group>
				<label>전자우편 주소</label>
				${hostconfig.disable_email ? '' : `<input type=email name=email class=form-control />`}
				${req.method == 'POST' && !error && duplicate ? (error = err('p', { msg: '해당 이메일로 이미 계정 생성 인증 메일을 보냈습니다.' })) : ''}
				${req.method == 'POST' && !error && userduplicate ? (error = err('p', { msg: '이메일이 이미 존재합니다.' })) : ''}
				${req.method == 'POST' && !error && invalidemail ? (error = err('p', { msg: '이메일의 값을 형식에 맞게 입력해주세요.' })) : ''}
				${emailfilter}
			</div>
			
			<p>
				<strong>가입후 탈퇴는 불가능합니다.</strong>
			</p>
		
			<div class=btns>
				<button type=reset class="btn btn-secondary">초기화</button>
				<button type=submit class="btn btn-primary">가입</button>
			</div>
		</form>
	`;
	
	if(req.method == 'POST' && !error) {
		await curs.execute("delete from account_creation where cast(time as integer) < ?", [Number(getTime()) - 86400000]);
		const key = rndval('abcdef1234567890', 64);
		curs.execute("insert into account_creation (key, email, time) values (?, ?, ?)", [key, req.body['email'], String(getTime())]);
		
		if(hostconfig.disable_email) return res.redirect('/member/signup/' + key);
		
		return res.send(await render(req, '계정 만들기', `
			<p>
				이메일(<strong>${req.body['email']}</strong>)로 계정 생성 이메일 인증 메일을 전송했습니다. 메일함에 도착한 메일을 통해 계정 생성을 계속 진행해 주시기 바랍니다.
			</p>

			<ul class=wiki-list>
				<li>간혹 메일이 도착하지 않는 경우가 있습니다. 이 경우, 스팸함을 확인해주시기 바랍니다.</li>
				<li>인증 메일은 24시간동안 유효합니다.</li>
			</ul>
			
			${hostconfig.debug ? 
				`<p style="font-weight: bold; color: red;">
					[디버그] 가입 주소: <a href="/member/signup/${key}">/member/signup/${key}</a>
				</p>` : ''}
		`, {}));
	}
	
	res.send(await render(req, '계정 만들기', content, {}, _, error, 'signup'));
});

router.all(/^\/member\/signup\/(.*)$/, async function signupScreen(req, res, next) {
	if(!['GET', 'POST'].includes(req.method)) return next();
	
	await curs.execute("delete from account_creation where cast(time as integer) < ?", [Number(getTime()) - 86400000]);
	
	const key = req.params[0];
	var credata = await curs.execute("select email from account_creation where key = ?", [key]);
	if(!credata.length) {
		return res.send(await showError(req, 'invalid_signup_key'));
	}
	
	var desturl = req.query['redirect'];
	if(!desturl) desturl = '/';
	
	if(islogin(req)) { res.redirect(desturl); return; }
	
	var id = '1', pw = '1', pw2 = '1';
	
	var content = '';
	var error = null;
	
	if(req.method == 'POST') do {
		id = req.body['username'] || '';
		pw = req.body['password'] || '';
		pw2 = req.body['password_check'] || '';
		
		if(!hostconfig.no_username_format && (id.length < 3 || id.length > 32 || id.match(/(?:[^A-Za-z0-9_])/))) {
			var invalidformat = 1;
			break;
		}
		
		if((hostconfig.reserved_usernames || []).concat(['namubot']).includes(id)) {
			var invalidusername = 1;
			break;
		}
		
		var data = await curs.execute("select username from users where lower(username) = ? COLLATE NOCASE", [id.toLowerCase()]);
		if(data.length) {
			var duplicate = 1;
			break;
		}
	} while(0);
	
	content += `
		<form class=signup-form method=post>
			<div class=form-group>
				<label>사용자 ID</label>
				<input class=form-control name="username" type="text" value="${html.escape(req.method == 'POST' ? req.body['username'] : '')}" />
				${req.method == 'POST' && !error && !id.length ? (error = err('p', { code: 'validator_required', tag: 'username' })) : ''}
				${req.method == 'POST' && !error && duplicate ? (error = err('p', 'username_already_exists')) : ''}
				${req.method == 'POST' && !error && invalidusername ? (error = err('p', 'invalid_username')) : ''}
				${req.method == 'POST' && !error && invalidformat ? (error = err('p', 'username_format')) : ''}
			</div>

			<div class=form-group>
				<label>비밀번호</label>
				<input class=form-control name="password" type="password" />
				${req.method == 'POST' && !error && !pw.length ? (error = err('p', { code: 'validator_required', tag: 'password' })) : ''}
			</div>

			<div class=form-group>
				<label>비밀번호 확인</label>
				<input class=form-control name="password_check" type="password" />
				${req.method == 'POST' && !error && !pw2.length ? (error = err('p', { code: 'validator_required', tag: 'password_check' })) : ''}
				${req.method == 'POST' && !error && pw2 != pw ? (error = err('p', { msg: '암호 확인이 올바르지 않습니다.' })) : ''}
			</div>
			
			<p><strong>가입후 탈퇴는 불가능합니다.</strong></p>
			
			<div class=btns>
				<button type=reset class="btn btn-secondary">초기화</button>
				<button type=submit class="btn btn-primary">가입</button>
			</div>
		</form>
	`;
	
	if(req.method == 'POST' && !error) do {
		var baserev = 0;
		var data = await curs.execute("select rev from history where title = ? and namespace = ? order by CAST(rev AS INTEGER) desc limit 1", [id, '사용자']);
		if(data.length) baserev = Number(data[0].rev);
		
		var data = await curs.execute("select title from documents where title = ? and namespace = ?", [id, '사용자']);
		if(data.length) {
			error = err('alert', 'edit_conflict');
			content = error + content;
			break; }
		
		permlist[id] = [];
		
		var data = await curs.execute("select username from users");
		if(!data.length) {
			for(var perm of perms) {
				if(disable_autoperms.includes(perm)) continue;
				curs.execute(`insert into perms (username, perm) values (?, ?)`, [id, perm]);
				permlist[id].push(perm);
			}
		}
		
		req.session.username = id;
		
		await curs.execute("insert into users (username, password) values (?, ?)", [id, sha3(pw)]);
		await curs.execute("insert into user_settings (username, key, value) values (?, 'email', ?)", [id, credata[0].email]);
		await curs.execute("insert into documents (title, namespace, content) values (?, '사용자', '')", [id]);
		await curs.execute("insert into history (title, namespace, content, rev, time, username, changes, log, iserq, erqnum, advance, ismember) \
						values (?, '사용자', '', ?, ?, ?, '0', '', '0', '', 'create', 'author')", [
							id, String(baserev + 1), getTime(), id
						]);
		if(!hostconfig.disable_login_history) {
			await curs.execute("insert into login_history (username, ip) values (?, ?)", [id, ip_check(req, 1)]);
			await curs.execute("insert into useragents (username, string) values (?, ?)", [id, req.headers['user-agent']]);
		}
		await curs.execute("delete from account_creation where key = ?", [key]);
		
		return res.send(await render(req, '계정 만들기', `
			<p>환영합니다! <strong>${html.escape(id)}</strong>님 계정 생성이 완료되었습니다.</p>
		`, {}));
	} while(0);
	
	res.send(await render(req, '계정 만들기', content, {}, _, error, 'signup'));
});
