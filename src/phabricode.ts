import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {RestApi} from './restapi';

interface CommentsRepository {
	[key: string]: string;
 }

enum CommentType {
	main,
	code
}
;
interface CommentWrapper {
	readonly commentType: CommentType,
	readonly comment: vscode.Comment,
	readonly path?: string,
	readonly line?: number,
	readonly length?: number
}

export class PhabNodeProvider implements vscode.TreeDataProvider<ReviewDependency|TopLevelDependency|CommentDependency> {

	private _onDidChangeTreeData: vscode.EventEmitter<ReviewDependency | undefined | void> = new vscode.EventEmitter<ReviewDependency | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<ReviewDependency | undefined | void> = this._onDidChangeTreeData.event;
	private phabUrl: string;
	private phabToken: string;
	private userPhib?: string;
	private phabsToContent: CommentsRepository;
	private commentController: vscode.CommentController;
	private authorPhidToUsername: Map<string, string>;
	private allCommentThreads: Array<vscode.CommentThread>;
	private repoPHIDToWorkspaceFolder: Map<string, string>;

	constructor(commentController: vscode.CommentController) {
		// TODO: raise if this doesn't exist!
		let rawdata = fs.readFileSync(require('os').homedir() + '/.arcrc', 'utf8');
		let arc = JSON.parse(rawdata);
		const config = vscode.workspace.getConfiguration('phabricode');
		// if the user has specified a host, we use this
		if (config.arcrc.host !== null) {
			this.phabUrl = config.arcrc.host;
		} else {
			// otherwise we take the first one defined in the .arcrc file
			// TODO: if it's empty, we should raise
			this.phabUrl = Object.keys(arc.hosts)[0];
		}
		this.phabToken = arc.hosts[this.phabUrl].token;
		/*
		In case of a workspace with a multiple roots we need to be able to tell which phab belongs to which repo.
		We do this by mapping a repo's callsign (easier to handle than the actual PHID for the user) to a workspace
		folder.

		E.g. a callsign of Pepper maps to a phid such as PHID-REPO-<hash> - which is what the repositoryPHID
		field on a phab for that repo would reference. This would then be mapped to (hopefully) a folder present
		in vscode.workspace.workspaceFolders.

		TODO: what if we reference a non-existing folder?
		*/
		this.repoPHIDToWorkspaceFolder = new Map<string, string>();
		if (Object.keys(config.workspace.repoCallSignToWorkspaceFolder).length > 0) {
			const constraints = {};
			Object.keys(config.workspace.repoCallSignToWorkspaceFolder).forEach((callSign, idx) => constraints[`constraints[callsigns][${idx}]`] = callSign);
			RestApi.post(this.phabUrl, 'diffusion.repository.search', this.phabToken, constraints).then(repoQuery => {
				repoQuery.result.data.forEach(entry => {
					// the callSign seems to always be returned as upper-case from phabricator, so we need to map in a case-insensitive way
					const key = Object.keys(config.workspace.repoCallSignToWorkspaceFolder).find(k => k.toLowerCase() === entry.fields.callsign.toLowerCase())
					this.repoPHIDToWorkspaceFolder.set(entry.phid,config.workspace.repoCallSignToWorkspaceFolder[key]);
				});
				console.log(`Mapped ${this.repoPHIDToWorkspaceFolder.size} repos to workspace folders: ${[...this.repoPHIDToWorkspaceFolder.entries()]}`);
			}).catch(err => {
				// TODO: do something
				console.log(`Error calling diffusion.repository.search: ${err}`);
				vscode.window.showErrorMessage("Unable to fetch results from Phabricator - please check the logs for details");
			});
		}
		this.phabsToContent = {};
		this.commentController = commentController;
		this.authorPhidToUsername = new Map<string, string>();
		this.allCommentThreads = new Array<vscode.CommentThread>();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: ReviewDependency): vscode.TreeItem {
		return element;
	}

	getChildren(element?: TopLevelDependency|ReviewDependency): Thenable<(ReviewDependency| TopLevelDependency | CommentDependency)[]> {
		if (element) {
			if (element instanceof TopLevelDependency) {
				return Promise.resolve(this.getReviews(element.depType));
			} else {
				// we could add another node here with things like build status
				// perhaps people who commented on the phab?
			}
		} else {
			return Promise.resolve(this.getTopLevelSections());
		}
	}
	private async getUsernameFromAuthorPhid(phid: string): Promise<string> {
		if (!this.authorPhidToUsername.has(phid)) {
			const filter = {'phids[0]': phid};
			const user = await RestApi.post(this.phabUrl, 'user.query', this.phabToken, filter);
			this.authorPhidToUsername.set(phid, user.result[0].userName);
		}
		return Promise.resolve(this.authorPhidToUsername.get(phid));
	}

	private async processItem(item: any) : Promise<Array<CommentWrapper>>{
		const commentAuthor = await this.getUsernameFromAuthorPhid(item.authorPHID);
		const comments: Array<CommentWrapper> = new Array<CommentWrapper>();
		let commentType: CommentType;
		let path: string;
		let line: number;
		let length: number;
		if (Object.keys(item.fields).length) {
			commentType = CommentType.code;
			path = item.fields.path;
			line = item.fields.line;
			length = item.fields.length;
		}
		// generic comment
		else {
			commentType = CommentType.main;
		}
		/*
		most of the time each item would only have a single comment - however the comments attribute
		supports more than one comment for the same block of code, so we need to support that too
		*/
		item.comments.forEach(comment => {
			const vscomment: vscode.Comment = {
				author: {name: commentAuthor},
				body: new vscode.MarkdownString(comment.content.raw),
				mode: vscode.CommentMode.Preview,
			};
			const wrapper: CommentWrapper = {commentType:commentType, comment:vscomment, path: path, line: line, length: length};
			comments.push(wrapper);
		});
		
		return Promise.resolve(comments);
	}


	public async loadPhabFromUserInput() {
		// this takes user input and tries to make an educated guess as to what the ID should be
		// this can be in a D* format, a URL, or even just digits
		const input = await vscode.window.showInputBox({placeHolder: "Enter a URL, D<...>, or just a revision ID"});
		const match = input.match(/[0-9]+$/);
		if (match !== null && match.length > 0) {
			const id = match[0];
			const filter = {'constraints[ids][0]': id};
			const revisions = await RestApi.post(this.phabUrl, 'differential.revision.search', this.phabToken, filter);
			if (revisions.result.data.length > 0) {
				const phid = revisions.result.data[0].phid;
				console.log(`mapped ${input} to ${phid}`);
				await this.loadPhab(phid);
			} else {
				// no result!
				vscode.window.showErrorMessage(`Phabricode: No phab with ID ${id} found!`);
			}

		} else {
			vscode.window.showErrorMessage(`Phabricode: Could not infer ID from ${input}`);
		}
	}

	public async loadPhab(phid: string) {
		/*
		The user clicked on the review. Let's query the phab and create the content of what we want to display.

		But first, we'll delete existing comment threads - it can get messy otherwise and I don't have a better
		way of dealing with this just yet.
		*/

		this.allCommentThreads.forEach(thread => thread.dispose());

		const filterA = {'constraints[phids][0]': phid};
		const diff = await RestApi.post(this.phabUrl, 'differential.revision.search', this.phabToken, filterA);
		const objKey = `D${diff.result.data[0].id}.md`;
		const uri = vscode.Uri.parse(`phab:${objKey}`);
		const filterB = {'objectIdentifier': phid};
		const phab = await RestApi.post(this.phabUrl, 'transaction.search', this.phabToken, filterB);

		/*
		Comments can be at the phab level or for a specific file/line of code

		In the case of the latter the "fields" attribute will contain the required details:

		"fields": {
                    "diff": {
                        "id": 123,
                        "phid": "PHID-DIFF-foo"
                    },
                    "path": "src/app/sauce.py",
                    "line": 53,
                    "length": 1,
                    "replyToCommentPHID": null,
                    "isDone": false
                }

		All comments at the phab level should be automatically allocated to the Dxxxx.md URI

		Note that the transaction.search API call returns the latest update first

		Also, it doesn't seem that the conduit 
		*/

		const itemPromises = phab.result.data.filter(item => item.comments.length >0).map(item => this.processItem(item));
		const nestedItems: Array<Array<CommentWrapper>> = (await Promise.all(itemPromises));
		// can't seem to do it in one line, otherwise it complains about types
		const items = nestedItems.reduce((acc, curr) => acc.concat(curr), []);
		
		let uriRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
		if (vscode.workspace.workspaceFolders.length > 1) {
			// c.f. constructor as to why we do this
			const workspaceFolder = this.repoPHIDToWorkspaceFolder.get(diff.result.data[0].fields.repositoryPHID);
			console.log([...this.repoPHIDToWorkspaceFolder.entries()]);
			uriRoot = vscode.workspace.workspaceFolders.find(item => item.name === workspaceFolder).uri.fsPath;
			console.log(`uriRoot for ${phid} is ${uriRoot}`);
		}

		/*
		Code threads:
		Here we need to create a new thread for each <path, line> pair - the length of which will be the maximum
		length across all comments for that pair. Unfortunately we can't quite use tuples as keys so we need to nest
		maps to replicate
		*/
		const blocksToThreads = new Map<string, Map<number, [Array<vscode.Comment>, number]>>();
		items.filter(commentWrapper => commentWrapper.commentType === CommentType.code ).forEach(commentWrapper => 
			{
				const fileThreadsMap = blocksToThreads.get(commentWrapper.path) || new Map<number, [Array<vscode.Comment>, number]>();
				const [comments, length] = fileThreadsMap.get(commentWrapper.line) || [new Array<vscode.Comment>(), 0];
				comments.push(commentWrapper.comment);
				comments.reverse(); // in-place
				fileThreadsMap.set(commentWrapper.line, [comments, Math.max(length, commentWrapper.length)]);
				blocksToThreads.set(commentWrapper.path, fileThreadsMap);
			}
		);
		blocksToThreads.forEach((fileComments, filePath) => 			
			fileComments.forEach(([comments, length], line) => {
				const thread = this.commentController.createCommentThread(
					vscode.Uri.parse(path.join(uriRoot, filePath)),
					new vscode.Range(line,0,line+length,0),						
					comments
				);
				thread.canReply = false;
				console.debug(`Creating a comment for ${filePath}:${line}:${length}`);
				this.allCommentThreads.push(thread);
				}	
		));
		// what if this is empty?
		this.phabsToContent[objKey] = this.formatPhabContent(diff.result.data[0]);

		/*
		main phab thread (not tagged to a particular code block)
		*/
		const mainComments = items.filter(commentWrapper=> commentWrapper.commentType === CommentType.main).map(commentWrapper => commentWrapper.comment);
		mainComments.reverse();
		// used to postion our main phab thread
		const mainThreadIndex = this.phabsToContent[objKey].split(/\r?\n/).length;
		const thread = this.commentController.createCommentThread(
			vscode.Uri.parse(`phab:${objKey}`),
			new vscode.Range(mainThreadIndex,0,mainThreadIndex+1,1),
			mainComments,
		);
		thread.canReply = false;
		thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
		this.allCommentThreads.push(thread);

		const doc = await vscode.workspace.openTextDocument(uri); // calls back into the provider
		await vscode.window.showTextDocument(doc, { preview: false });
	}

	private formatPhabContent(diff: any) : string{
		return String.raw`${diff.fields.title}

## Summary

${diff.fields.summary}

## Test Plan

${diff.fields.testPlan}

## Comments
`;
	}

	public async fetchPhabDetails(reviewUri: vscode.Uri, showAll?: Boolean): Promise<string> {
		// this gets called by the TextDocumentContentProvider
		// it should return the contents we want to display, loaded via loadPhab
		// map uri to phid - it's the revisionID
		// 
		// either that or keep a map from getReviews and use that instead - probably neater
		return Promise.resolve(this.phabsToContent[reviewUri.path]);
	}

	private async getTopLevelSections(): Promise<TopLevelDependency[]> {
		return Promise.resolve(new Array(
			new TopLevelDependency("Ready to Land", vscode.TreeItemCollapsibleState.Collapsed, DepType.mineReadyToLand),
			new TopLevelDependency("Waiting on Review", vscode.TreeItemCollapsibleState.Collapsed, DepType.mineNeedsReview),
			new TopLevelDependency("Ready to Review", vscode.TreeItemCollapsibleState.Collapsed, DepType.others),
			new TopLevelDependency("Changes Planned", vscode.TreeItemCollapsibleState.Collapsed, DepType.changesPlanned)
			));
	}

	private async phabToReviewDependency(phab: any): Promise<ReviewDependency> {
		const author = await this.getUsernameFromAuthorPhid(phab.fields.authorPHID);
		console.debug(`(${author}) ${phab.fields.title}`);
		return Promise.resolve(new ReviewDependency(`${phab.fields.title} - ${author}`, phab.phid, phab.fields.uri, vscode.TreeItemCollapsibleState.None,//Collapsed, 
			{
			command: 'phabricode.loadPhab',
			title: 'Load phab',
			arguments: [phab.phid]
		}));
	}

	private async getReviews(depType: DepType): Promise<ReviewDependency[]> {
		if (!this.userPhib) {
			const userData = await RestApi.post(this.phabUrl, 'user.whoami', this.phabToken, {});
			this.userPhib = userData.result.phid;
		}
		let filters = {};
		switch (depType) {
			case DepType.mineNeedsReview:
				filters['constraints[authorPHIDs][0]'] = this.userPhib;
				filters['constraints[statuses][0]']= 'needs-review';
				break;
			case DepType.mineReadyToLand:
				filters['constraints[authorPHIDs][0]'] = this.userPhib;
				filters['constraints[statuses][0]']= 'accepted';
				break;
			case DepType.changesPlanned:
					filters['constraints[authorPHIDs][0]'] = this.userPhib;
					filters['constraints[statuses][0]']= 'changes-planned';
					break;
			case DepType.others:
				filters['constraints[reviewerPHIDs][0]'] = this.userPhib;
				filters['constraints[statuses][0]']= 'needs-review';
				break;

		}
		const phabs = await RestApi.post(this.phabUrl, 'differential.revision.search', this.phabToken, filters);
		const phabPromises = phabs.result.data.map(phab => this.phabToReviewDependency(phab));
		return await Promise.all(phabPromises);
	}

}
enum DepType {
	mineReadyToLand,
	mineNeedsReview,
	others,
	changesPlanned
}
export class CommentDependency extends vscode.TreeItem {
	constructor(
		public readonly comment: string,
		public readonly filename: string,
		public readonly line: number,
		public readonly length: number
	 ) {
		super(comment.substring(0,10), vscode.TreeItemCollapsibleState.None)
	}

	iconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'dependency.svg'),
		dark: path.join(__filename, '..', '..', 'media', 'phabricator_eye.png')
	};

	contextValue = 'dependency';
}
export class TopLevelDependency extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly depType: DepType,
	 ) {
		super(label, collapsibleState);
	}

	iconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'dependency.svg'),
		dark: path.join(__filename, '..', '..', 'media', 'phabricator_eye.png')
	};

	contextValue = 'not-a-dependency';
}

export class ReviewDependency extends vscode.TreeItem {

	constructor(
		public readonly label: string,
		public readonly phid: string,
		private readonly uri: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command,
	) {
		super(label, collapsibleState);

		this.tooltip = `${this.label}`;
		this.description = this.uri;
	}

	iconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'dependency.svg'),
		dark: path.join(__filename, '..', '..', 'media', 'phabricator_eye.png')
	};

	contextValue = 'dependency';
}
let commentId = 1;

export class NoteComment implements vscode.Comment {
	id: number;
	label: string | undefined;
	constructor(
		public body: string | vscode.MarkdownString,
		public mode: vscode.CommentMode,
		public author: vscode.CommentAuthorInformation,
		public parent?: vscode.CommentThread,
		public contextValue?: string
	) {
		this.id = ++commentId;
	}
}