// --- API ENTRY POINTS ---
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', version: '3.0.0-nested-folders' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const action = e.parameter.action;
  
  let requestData = {};
  if (e.postData && e.postData.contents) {
    try {
      requestData = JSON.parse(e.postData.contents);
    } catch (err) { }
  }

  const userEmail = requestData.email || e.parameter.email;
  const finalAction = action || requestData.action; 

  try {
    // 1. REGISTRATION API
    if (finalAction === 'registerUser') {
      if (!userEmail) return createResponse({status: 'error', message: 'No email provided'});
      
      const payloadObj = requestData.payload || {};
      const displayName = payloadObj.displayName || 'Unnamed User';
      
      const roleObj = getUserDetails(userEmail);
      if (roleObj && roleObj.role !== 'none') {
         return createResponse({status: 'error', message: 'Account already exists'});
      }
      
      try {
        const sheet = getDb().getSheetByName('Users');
        if (!sheet) return createResponse({status: 'error', message: 'ERROR: The Google Sheet does not have a "Users" tab.'});
        
        sheet.appendRow([userEmail, 'user', displayName]);
        
        // Auto-create their default ledger folder so they don't have to manually.
        createFolder(userEmail.toLowerCase(), null, "My Commitments");
        
        return createResponse({status: 'success', message: 'User registered successfully'});
      } catch (err) {
        return createResponse({status: 'error', message: 'Registration Failed: ' + err.toString()});
      }
    }

    // AUTHENTICATION CHECK
    if (!userEmail) return createResponse({ status: 'error', message: 'No email provided.' });
    const userEmailStr = userEmail.toLowerCase();
    const userDetails = getUserDetails(userEmailStr);
    if (!userDetails || userDetails.role === 'none') {
      return createResponse({ status: 'error', message: 'Access denied. Email not registered.' });
    }

    if (finalAction === 'verifyRole') {
       return createResponse({ status: 'success', displayName: userDetails.displayName });
    }
       
    // --- FOLDER ACTIONS ---
    const parentId = requestData.payload ? requestData.payload.parentId : null; // Can be null for root

    if (finalAction === 'getFolders') {
      // Returns all folders at a specific depth the user has access to
      const data = getFoldersForUser(userEmailStr, parentId);
      return createResponse({ status: 'success', data: data });
    } 
    else if (finalAction === 'createFolder') {
      // If parentId exists, user must have access to that parent folder
      if (parentId && !hasFolderAccess(userEmailStr, parentId)) return createResponse({status: 'error', message: 'Access denied to parent folder'});
      
      const result = createFolder(userEmailStr, parentId, requestData.payload.name);
      return createResponse({ status: 'success', item: result });
    }
    else if (finalAction === 'shareItems') {
      const { shareEmail, itemNames } = requestData.payload;
      
      const sheet = getDb().getSheetByName('Commitments');
      const data = sheet.getDataRange().getValues();
      let sharedCount = 0;
      const targetEmail = shareEmail.trim().toLowerCase();
      
      // We identify items by their Name (decoded) and Folder Owner.
      // Easiest robust approach: just find items matching the names owned by currentUser
      const allFolders = getAllFolders();
      const myFolderIds = allFolders.filter(f => f.owner === userEmailStr).map(f => f.id);
      
      for (let i = 1; i < data.length; i++) {
        if (!data[i][0]) continue;
        
        const fId = data[i][1].toString();
        if (myFolderIds.includes(fId)) {
             let decodedName = "";
             try {
                 decodedName = Utilities.newBlob(Utilities.base64Decode(data[i][2].toString())).getDataAsString();
             } catch(e) {
                 decodedName = data[i][2].toString();
             }
             
             if (itemNames.includes(decodedName)) {
                // Column J (index 9) is SharedEmails
                const currentShared = data[i].length > 9 && data[i][9] ? data[i][9].toString() : '';
                let sharedArray = currentShared.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
                
                if (!sharedArray.includes(targetEmail) && targetEmail !== userEmailStr) {
                  sharedArray.push(targetEmail);
                  // Ensure Column J exists if this is the first share
                  sheet.getRange(i + 1, 10).setValue(sharedArray.join(','));
                  sharedCount++;
                }
             }
        }
      }
      return createResponse({ status: 'success', message: `Shared ${itemNames.length} commitments successfully.` });
    }
    else if (finalAction === 'unshareItem') {
      const { itemName, targetEmail } = requestData.payload;
      
      const sheet = getDb().getSheetByName('Commitments');
      const data = sheet.getDataRange().getValues();
      let revokedCount = 0;
      const emailToRemove = targetEmail.trim().toLowerCase();
      
      const allFolders = getAllFolders();
      // If userEmailStr is the one requesting, they are either the owner revoking someone else, 
      // or they are the recipient removing themselves.
      const myFolderIds = allFolders.filter(f => f.owner === userEmailStr).map(f => f.id);
      
      for (let i = 1; i < data.length; i++) {
        if (!data[i][0]) continue;
        
        const fId = data[i][1].toString();
        let decodedName = "";
        try {
             decodedName = Utilities.newBlob(Utilities.base64Decode(data[i][2].toString())).getDataAsString();
        } catch(e) {
             decodedName = data[i][2].toString();
        }
        
        if (decodedName === itemName) {
            // Check authorization: Is current user the owner of the ledger? Or is the current user the one being removed?
            const isOwner = myFolderIds.includes(fId);
            const isSelfRemove = (emailToRemove === userEmailStr);
            
            if (isOwner || isSelfRemove) {
                const currentShared = data[i].length > 9 && data[i][9] ? data[i][9].toString() : '';
                let sharedArray = currentShared.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
                
                const index = sharedArray.indexOf(emailToRemove);
                if (index > -1) {
                  sharedArray.splice(index, 1);
                  sheet.getRange(i + 1, 10).setValue(sharedArray.join(','));
                  revokedCount++;
                }
            }
        }
      }
      return createResponse({ status: 'success', message: `Revoked access successfully.` });
    }

    // --- CHECKLIST / COMMITMENT ACTIONS ---
    const explicitFolderId = requestData.payload ? requestData.payload.folderId : null;

    if (finalAction === 'getChecklist') {
      // Returns ALL commitments the user has access to, across ALL their ledgers
      const data = getAllMyCommitments(userEmailStr);
      return createResponse({ status: 'success', data: data });
    } 
    else if (finalAction === 'addCommitment') {
      // We look at the payload's Due Date, figure out the Month/Year, and put it in that specific virtual ledger.
      let dateObj = new Date(requestData.payload.dueDate);
      if (isNaN(dateObj)) dateObj = new Date();
      const monthYear = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
      const expectedLedgerName = `Ledger: ${monthYear}`;
      
      // Does a virtual ledger exist for this month?
      const myFolders = getFoldersForUser(userEmailStr, null).filter(f => f.isOwner);
      let targetFolderId = null;
      
      const existingLedger = myFolders.find(f => f.name === expectedLedgerName);
      if (existingLedger) {
          targetFolderId = existingLedger.id;
      } else {
          // Auto-create month ledger on the fly
          const newF = createFolder(userEmailStr, null, expectedLedgerName);
          targetFolderId = newF.id;
      }
      
      if (!hasFolderAccess(userEmailStr, targetFolderId)) return createResponse({ status: 'error', message: 'Access denied to Ledger' });
      
      const result = addCommitment(targetFolderId, requestData.payload);
      return createResponse({ status: 'success', item: result });
    } 
    else if (finalAction === 'updateStatus') {
      const folderId = requestData.payload.folderId;
      if (!folderId || !hasFolderAccess(userEmailStr, folderId)) return createResponse({ status: 'error', message: 'Access denied' });
      
      updateStatus(folderId, requestData.payload.id, requestData.payload.status);
      return createResponse({ status: 'success', message: 'Status updated' });
    } 
    else if (finalAction === 'batchUpdateStatus') {
      // payload expects: { updates: [ {id, folderId, status}, ... ] }
      const updates = requestData.payload.updates;
      if (!updates || !Array.isArray(updates)) return createResponse({ status: 'error', message: 'Invalid payload array' });
      
      const sheet = getDb().getSheetByName('Commitments');
      const data = sheet.getDataRange().getValues();
      let updatedCount = 0;
      
      // We do a single loop through the DB. For each row, check if it's in our updates list AND user has access.
      for (let i = 1; i < data.length; i++) {
         if (!data[i][0]) continue;
         const rowId = data[i][0].toString();
         const rowFolderId = data[i][1].toString();
         
         // Find matching update request
         const req = updates.find(u => u.id === rowId && u.folderId === rowFolderId);
         if (req) {
             // Verify permissions dynamically for safety
             if (hasFolderAccess(userEmailStr, rowFolderId)) {
                 sheet.getRange(i + 1, 6).setValue(req.status);
                 updatedCount++;
             }
         }
      }
      return createResponse({ status: 'success', message: `Batch updated ${updatedCount} items.` });
    }
    else if (finalAction === 'processTargetPayment') {
      const { folderId, id, paymentAmount } = requestData.payload;
      if (!folderId || !hasFolderAccess(userEmailStr, folderId)) return createResponse({ status: 'error', message: 'Access denied' });
      
      // Find the item, deduct balance, create new item in next month
      try {
          const resultMsg = processTargetPayment(userEmailStr, folderId, id, parseFloat(paymentAmount));
          return createResponse({ status: 'success', message: resultMsg });
      } catch (err) {
          return createResponse({ status: 'error', message: err.toString() });
      }
    }
    else if (finalAction === 'editCommitment') {
      const folderId = requestData.payload.folderId;
      if (!folderId || !hasFolderAccess(userEmailStr, folderId)) return createResponse({ status: 'error', message: 'Access denied' });
      
      editCommitment(folderId, requestData.payload);
      return createResponse({ status: 'success', message: 'Edited successfully' });
    } 
    else if (finalAction === 'deleteCommitment') {
      const folderId = requestData.payload.folderId;
      if (!folderId || !hasFolderAccess(userEmailStr, folderId)) return createResponse({ status: 'error', message: 'Access denied' });
      
      const isOwner = isFolderOwner(userEmailStr, folderId);
      if (isOwner) {
        // If owner, actually delete the row
        deleteCommitment(folderId, requestData.payload.id);
        return createResponse({ status: 'success', message: 'Item permanently deleted' });
      } else {
        // If sharee, remove them from the folder's shared list (unshare)
        unshareFolder(userEmailStr, folderId);
        return createResponse({ status: 'success', message: 'Ledger un-shared from your account' });
      }
    } 
    
    // --- ANALYTICS API ---
    else if (finalAction === 'getDashboardAnalytics') {
      const stats = calculateAnalytics(userEmailStr);
      return createResponse({ status: 'success', data: stats });
    }
    
    else {
      return createResponse({ status: 'error', message: 'Unknown action: ' + finalAction });
    }
  } catch (err) {
    return createResponse({ status: 'error', message: err.toString() });
  }
}

function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getDb() { return SpreadsheetApp.getActiveSpreadsheet(); }

// --- USER HELPERS ---
function getUserDetails(email) {
  if (!email) return { role: 'none', displayName: '' };
  const sheet = getDb().getSheetByName('Users');
  if (!sheet) throw new Error('Users sheet not found. Need columns: Email, Role, DisplayName');
  
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim().toLowerCase() === email.toLowerCase()) {
      const roleStr = data[i][1].toString().trim().toLowerCase();
      // Safely grab DisplayName (column index 2), or default to email prefix
      const dispName = (data[i].length > 2 && data[i][2]) ? data[i][2].toString() : email.split('@')[0];
      return { 
        role: roleStr === 'admin' ? 'admin' : 'user',
        displayName: dispName
      };
    }
  }
  return { role: 'none', displayName: '' };
}

// --- FOLDER LOGIC ---
function getAllFolders() {
  const sheet = getDb().getSheetByName('Folders');
  if (!sheet) throw new Error('Folders sheet not found. Ensure Headers: ID, ParentID, OwnerEmail, Name, SharedEmails');
  const data = sheet.getDataRange().getValues();
  const folders = [];
  
  // ID, ParentID, OwnerEmail, Name, SharedEmails
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const sharedRaw = data[i][4] ? data[i][4].toString() : '';
    folders.push({
      id: data[i][0].toString(),
      parentId: data[i][1] ? data[i][1].toString() : null,
      owner: data[i][2].toString().toLowerCase(),
      name: data[i][3].toString(),
      sharedWith: sharedRaw.split(',').map(s => s.trim().toLowerCase()).filter(s => s)
    });
  }
  return folders;
}

// Check if user is the explicit owner of the folder
function isFolderOwner(email, folderId) {
  const allFolders = getAllFolders();
  const f = allFolders.find(x => x.id === folderId);
  return f && f.owner === email;
}

// Check if a user has access to a specific folder (either directly, or inherited from a parent)
function hasFolderAccess(email, folderId) {
  const allFolders = getAllFolders();
  let currentId = folderId;
  
  // First, check direct access to the requested folder
  const targetFolder = allFolders.find(x => x.id === folderId);
  if (targetFolder && (targetFolder.owner === email || targetFolder.sharedWith.includes(email))) {
      return true;
  }
  
  // Traverse UP the tree. If ANY parent is shared with user (or owned by user), they have access to all children.
  while (currentId) {
    const f = allFolders.find(x => x.id === currentId);
    if (!f) return false; // Broken link
    
    if (f.owner === email || f.sharedWith.includes(email)) return true;
    currentId = f.parentId; // Move up one level
  }
  return false;
}

function getFoldersForUser(email, targetParentId) {
  const allFolders = getAllFolders();
  const result = [];
  
  for (const folder of allFolders) {
    if (targetParentId === null) {
      // IF AT ROOT LEVEL:
      // Show folders the user owns that have no parent
      if (folder.parentId === null && folder.owner === email) {
        result.push(formatFolderOutput(folder, email));
      } 
      // Show folders explicitly shared with the user (regardless of parentId) so they appear in their root
      else if (folder.sharedWith.includes(email)) {
        result.push(formatFolderOutput(folder, email));
      }
    } else {
      // IF INSIDE A FOLDER:
      // Only show direct children of this exact folder, IF the user has access to it
      if (folder.parentId === targetParentId && hasFolderAccess(email, folder.id)) {
        result.push(formatFolderOutput(folder, email));
      }
    }
  }
  return result;
}

function formatFolderOutput(folder, email) {
  return {
    id: folder.id,
    parentId: folder.parentId,
    name: folder.name,
    owner: folder.owner,
    isOwner: folder.owner === email,
    sharedWith: folder.sharedWith
  };
}

function createFolder(ownerEmail, parentId, name) {
  const sheet = getDb().getSheetByName('Folders');
  const id = 'FLD-' + Utilities.getUuid().substring(0, 8);
  sheet.appendRow([id, parentId || '', ownerEmail.toLowerCase(), name, '']);
  return { id, parentId: parentId || null, owner: ownerEmail, name, isOwner: true, sharedWith: [] };
}

// We will keep this function around just in case, but shareFolder endpoint now loops directly
function shareFolder(ownerEmail, folderId, shareEmail) {
  const sheet = getDb().getSheetByName('Folders');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString() === folderId) {
      if (data[i][2].toString().toLowerCase() !== ownerEmail) {
        throw new Error("You do not have permission to share this folder. Only the owner can share it.");
      }
      
      const currentShared = data[i][4] ? data[i][4].toString() : '';
      let sharedArray = currentShared.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
      
      const targetEmail = shareEmail.trim().toLowerCase();
      if (!sharedArray.includes(targetEmail) && targetEmail !== ownerEmail) {
        sharedArray.push(targetEmail);
        sheet.getRange(i + 1, 5).setValue(sharedArray.join(','));
      }
      return true;
    }
  }
  throw new Error("Folder not found");
}

function unshareFolder(userEmail, folderId) {
  const sheet = getDb().getSheetByName('Folders');
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString() === folderId) {
      const currentShared = data[i][4] ? data[i][4].toString() : '';
      let sharedArray = currentShared.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
      
      const index = sharedArray.indexOf(userEmail);
      if (index > -1) {
        sharedArray.splice(index, 1);
        sheet.getRange(i + 1, 5).setValue(sharedArray.join(','));
      }
      return true;
    }
  }
  throw new Error("Folder not found");
}

function getAllAccessibleFolderIds(email) {
  const allFolders = getAllFolders();
  const accessibleIds = new Set();
  // Find all accessible folders
  for (const f of allFolders) {
    if (hasFolderAccess(email, f.id)) {
      accessibleIds.add(f.id);
    }
  }
  return Array.from(accessibleIds);
}

// --- COMMITMENT LOGIC ---
function getAllMyCommitments(email) {
  const accessibleIds = getAllAccessibleFolderIds(email);
  if (accessibleIds.length === 0) return [];
  
  const sheet = getDb().getSheetByName('Commitments');
  const data = sheet.getDataRange().getValues();
  const commitments = [];
  
  // Need mappings for displaying owner names
  const allFolders = getAllFolders();
  const folderOwnerMap = {};
  const accessibleOwners = new Set([email]); // Always have access to our own targets
  
  // First pass: Find all owners that have shared at least one ledger with us
  accessibleIds.forEach(id => {
    const f = allFolders.find(x => x.id === id);
    if (f) {
      accessibleOwners.add(f.owner);
      const ownerDetails = getUserDetails(f.owner);
      const label = (f.owner === email) ? 'My Ledger' : (ownerDetails.displayName + "'s Ledger");
      folderOwnerMap[id] = label;
    }
  });
  
    // Headers: ID, FolderID, Name, Amount, Due Date, Status
    for (let i = 1; i < data.length; i++) {
        if (!data[i][0]) continue; 
        
        const fId = data[i][1].toString();
        const folderInfo = allFolders.find(x => x.id === fId);
        
        // We peek at the commitment Type (Column I, index 8) to know if it's a Target
        let type = "Fixed";
        if (data[i].length > 8 && data[i][8]) {
            type = data[i][8].toString();
        }
        
        let hasAccess = false;
        if (accessibleIds.includes(fId)) {
            hasAccess = true;
        } else if (type === 'Target' && folderInfo && accessibleOwners.has(folderInfo.owner)) {
            // Unconditionally grant access to Targets if we share ANY ledger with their owner
            hasAccess = true;
            
            // Build the folder map label dynamically for this unshared future virtual folder
            if (!folderOwnerMap[fId]) {
                const ownerDetails = getUserDetails(folderInfo.owner);
                folderOwnerMap[fId] = (folderInfo.owner === email) ? 'My Ledger' : (ownerDetails.displayName + "'s Ledger");
            }
        }
        
        if (hasAccess) {
            let decodedName = "Unknown";
            let decodedAmount = 0;
            let decodedTotal = 0;
            let decodedBalance = 0;
            let type = "Fixed";
            
            // Try to decode Base64. If it fails, assume it's legacy plaintext
            try {
                decodedName = Utilities.newBlob(Utilities.base64Decode(data[i][2].toString())).getDataAsString();
                decodedAmount = parseFloat(Utilities.newBlob(Utilities.base64Decode(data[i][3].toString())).getDataAsString()) || 0;
                
                // Parse Total Amount (Column G, index 6)
                if (data[i].length > 6 && data[i][6]) {
                    decodedTotal = parseFloat(Utilities.newBlob(Utilities.base64Decode(data[i][6].toString())).getDataAsString()) || 0;
                } else {
                    decodedTotal = 0; // Fallback for old entries
                }
                
                // Parse Balance (Column H, index 7)
                if (data[i].length > 7 && data[i][7]) {
                    decodedBalance = parseFloat(Utilities.newBlob(Utilities.base64Decode(data[i][7].toString())).getDataAsString()) || 0;
                } else {
                    decodedBalance = 0; // Fallback for old entries
                }
                
            } catch (e) {
                decodedName = data[i][2].toString();
                decodedAmount = parseFloat(data[i][3]) || 0;
                
                // Legacy plaintext fallback for Total and Balance
                decodedTotal = (data[i].length > 6 && data[i][6]) ? (parseFloat(data[i][6]) || 0) : 0;
                decodedBalance = (data[i].length > 7 && data[i][7]) ? (parseFloat(data[i][7]) || 0) : 0;
            }
            
            // Column I: Type (index 8)
            if (data[i].length > 8 && data[i][8]) {
                type = data[i][8].toString();
            } else {
                // Infer type for backward compatibility: if it has a balance, it's a Target
                if (decodedBalance > 0) type = "Target";
            }
            
            // Column J: SharedEmails (index 9)
            let sharedWithList = [];
            if (data[i].length > 9 && data[i][9]) {
                sharedWithList = data[i][9].toString().split(',').map(s => s.trim().toLowerCase()).filter(s => s);
            }

            commitments.push({
                id: data[i][0].toString(),
                folderId: fId,
                sourceLedger: folderOwnerMap[fId],
                name: decodedName,
                amount: decodedAmount,
                totalAmount: decodedTotal,
                balance: decodedBalance,
                type: type,
                dueDate: data[i][4] instanceof Date ? data[i][4].toISOString().split('T')[0] : data[i][4].toString(),
                status: data[i][5].toString(),
                sharedWith: sharedWithList,
                ownerEmail: folderInfo ? folderInfo.owner : 'unknown'
            });
        }
    }
  return commitments;
}

function addCommitment(folderId, payload) {
    const sheet = getDb().getSheetByName('Commitments');
    const id = Utilities.getUuid();
    
    // Obfuscate (Encrypt) data into Base64 to hide from sheet casual view
    const nameStr = payload.name.toString();
    const amountStr = (parseFloat(payload.amount) || 0).toString();
    const totalStr = (parseFloat(payload.totalAmount) || 0).toString();
    const balanceStr = (parseFloat(payload.balance) || 0).toString();
    
    const encodedName = Utilities.base64Encode(Utilities.newBlob(nameStr).getBytes());
    const encodedAmount = Utilities.base64Encode(Utilities.newBlob(amountStr).getBytes());
    const encodedTotal = Utilities.base64Encode(Utilities.newBlob(totalStr).getBytes());
    const encodedBalance = Utilities.base64Encode(Utilities.newBlob(balanceStr).getBytes());
    
    const dueDate = payload.dueDate; 
    const status = payload.status || 'Pending';
    const type = payload.type || 'Fixed';
    
    // Store obfuscated values in Sheet
    // Appending to Columns A:I -> ID, FolderID, Name, Amount, Due Date, Status, Total Amount, Balance, Type
    sheet.appendRow([id, folderId, encodedName, encodedAmount, dueDate, status, encodedTotal, encodedBalance, type]);
    
    // Return plaintext back to UI state
    return { id, folderId, name: payload.name, amount: parseFloat(payload.amount) || 0, totalAmount: parseFloat(payload.totalAmount) || 0, balance: parseFloat(payload.balance) || 0, type, dueDate, status };
}

function processTargetPayment(userEmailStr, folderId, id, paymentAmount) {
    const sheet = getDb().getSheetByName('Commitments');
    const data = sheet.getDataRange().getValues();
    
    let targetRow = -1;
    let decodedName = "";
    let decodedAmount = 0;
    let decodedTotal = 0;
    let decodedBalance = 0;
    let dueDateStr = "";
    
    // 1. Find the target commitment
    for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString() === id && data[i][1].toString() === folderId) {
            targetRow = i + 1;
            dueDateStr = data[i][4] instanceof Date ? data[i][4].toISOString().split('T')[0] : data[i][4].toString();
            try {
                decodedName = Utilities.newBlob(Utilities.base64Decode(data[i][2].toString())).getDataAsString();
                decodedAmount = parseFloat(Utilities.newBlob(Utilities.base64Decode(data[i][3].toString())).getDataAsString()) || 0;
                decodedTotal = parseFloat(Utilities.newBlob(Utilities.base64Decode(data[i][6].toString())).getDataAsString()) || 0;
                decodedBalance = parseFloat(Utilities.newBlob(Utilities.base64Decode(data[i][7].toString())).getDataAsString()) || 0;
            } catch (e) {
                decodedName = data[i][2].toString();
                decodedAmount = parseFloat(data[i][3]) || 0;
                decodedTotal = parseFloat(data[i][6]) || 0;
                decodedBalance = parseFloat(data[i][7]) || 0;
            }
            break;
        }
    }
    
    if (targetRow === -1) throw new Error("Commitment not found");
    
    // 2. Mark this month as paid (record actual amount paid rather than expected tracking amount if needed, but for simplicity we keep tracking amount and mark paid, or we update the amount to reflect exactly what they paid this month)
    const encodedPaidAmount = Utilities.base64Encode(Utilities.newBlob(paymentAmount.toString()).getBytes());
    sheet.getRange(targetRow, 4).setValue(encodedPaidAmount); // Update amount to actual payment
    sheet.getRange(targetRow, 6).setValue("Paid"); // Status
    
    // Calculate new balance
    const newBalance = decodedBalance - paymentAmount;
    
    if (newBalance <= 0) {
        // Debt is fully paid
        const encodedNewBalanceZero = Utilities.base64Encode(Utilities.newBlob("0").getBytes());
        sheet.getRange(targetRow, 8).setValue(encodedNewBalanceZero);
        return "Payment successful. Debt is fully cleared!";
    }
    
    // 3. Debt not cleared. Create rollover for next month.
    // Update the paid item to show the new reduced balance for historical accuracy
    const encodedNewBalance = Utilities.base64Encode(Utilities.newBlob(newBalance.toString()).getBytes());
    sheet.getRange(targetRow, 8).setValue(encodedNewBalance);
    
    // Generate next month's due date
    const currentDue = new Date(dueDateStr);
    currentDue.setMonth(currentDue.getMonth() + 1);
    const nextDueDateStr = currentDue.toISOString().split('T')[0];
    const nextMonthYear = currentDue.toLocaleString('default', { month: 'long', year: 'numeric' });
    const expectedLedgerName = `Ledger: ${nextMonthYear}`;
    
    // Find or create next month's folder
    const myFolders = getFoldersForUser(userEmailStr, null).filter(f => f.isOwner);
    let nextFolderId = null;
    const existingLedger = myFolders.find(f => f.name === expectedLedgerName);
    if (existingLedger) {
        nextFolderId = existingLedger.id;
    } else {
        const newF = createFolder(userEmailStr, null, expectedLedgerName);
        nextFolderId = newF.id;
    }
    
    // Add new commitment into next month
    addCommitment(nextFolderId, {
        name: decodedName,
        amount: decodedAmount, // Keep the original intended monthly payment amount for the new row
        totalAmount: decodedTotal,
        balance: newBalance,
        status: 'Pending',
        dueDate: nextDueDateStr,
        type: 'Target'
    });
    
    return `Payment of RM ${paymentAmount.toFixed(2)} recorded. Remaining balance (RM ${newBalance.toFixed(2)}) rolled over to ${nextMonthYear}.`;
}

function editCommitment(folderId, payload) {
    const sheet = getDb().getSheetByName('Commitments');
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString() === payload.id && data[i][1].toString() === folderId) {
            
            const nameStr = payload.name.toString();
            const amountStr = (parseFloat(payload.amount) || 0).toString();
            const totalStr = (parseFloat(payload.totalAmount) || 0).toString();
            const balanceStr = (parseFloat(payload.balance) || 0).toString();
            
            const encodedName = Utilities.base64Encode(Utilities.newBlob(nameStr).getBytes());
            const encodedAmount = Utilities.base64Encode(Utilities.newBlob(amountStr).getBytes());
            const encodedTotal = Utilities.base64Encode(Utilities.newBlob(totalStr).getBytes());
            const encodedBalance = Utilities.base64Encode(Utilities.newBlob(balanceStr).getBytes());

            sheet.getRange(i + 1, 3).setValue(encodedName);
            sheet.getRange(i + 1, 4).setValue(encodedAmount);
            sheet.getRange(i + 1, 5).setValue(payload.dueDate);
            if (payload.status) {
                sheet.getRange(i + 1, 6).setValue(payload.status);
            }
            sheet.getRange(i + 1, 7).setValue(encodedTotal);
            sheet.getRange(i + 1, 8).setValue(encodedBalance);
            if (payload.type) {
                sheet.getRange(i + 1, 9).setValue(payload.type);
            }
            return true;
        }
    }
  throw new Error('Commitment not found in this folder');
}

function updateStatus(folderId, id, newStatus) {
  const sheet = getDb().getSheetByName('Commitments');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString() === id && data[i][1].toString() === folderId) {
      sheet.getRange(i + 1, 6).setValue(newStatus);
      return true;
    }
  }
  throw new Error('Commitment not found in this folder');
}

function deleteCommitment(folderId, id) {
  const sheet = getDb().getSheetByName('Commitments');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0].toString() === id && data[i][1].toString() === folderId) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  throw new Error('Commitment not found in this folder');
}

// --- ANALYTICS ---
function calculateAnalytics(userEmail) {
  const allFolders = getAllFolders();
  // Find folders this user can access
  const accessibleFolders = allFolders.filter(f => hasFolderAccess(userEmail, f.id));
  if (accessibleFolders.length === 0) return { byOwner: {} };
  
  // We need a fast lookup for folder owner and owner's display name
  const folderOwnerMap = {};
  accessibleFolders.forEach(f => {
    // Attempt to lookup their DisplayName if they don't have one stored, just string fallback
    const ownerDetails = getUserDetails(f.owner);
    const label = (f.owner === userEmail) ? 'My Trackers' : (ownerDetails.displayName + "'s Trackers");
    
    folderOwnerMap[f.id] = label;
  });

  const sheet = getDb().getSheetByName('Commitments');
  const data = sheet.getDataRange().getValues();
  
  // Group by owner label string -> { pending: X, paid: Y }
  const byOwner = {};
  
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const fId = data[i][1].toString();
    
    // Skip if user doesn't have access to this folder
    if (!folderOwnerMap[fId]) continue; 
    
    const ownerLabel = folderOwnerMap[fId];
    if (!byOwner[ownerLabel]) {
       byOwner[ownerLabel] = { pending: 0, paid: 0 };
    }
    
    const amount = parseFloat(data[i][3]) || 0;
    const status = data[i][5].toString();
    
    if (status === 'Paid') {
      byOwner[ownerLabel].paid += amount;
    } else {
      byOwner[ownerLabel].pending += amount;
    }
  }
  
}

// =========================================================================
// ==================== MONTHLY AUTOMATION TRIGGER =====================
// =========================================================================

/**
 * Run this function ONCE from the Apps Script Editor to set up the automated trigger.
 * It will configure `autoGenerateNextMonth` to run on the 1st day of every month at midnight.
 */
function setupMonthlyTrigger() {
  // Clear any existing triggers first to avoid duplicates
  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoGenerateNextMonth') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Create trigger for 1st of the month at around midnight/1am
  ScriptApp.newTrigger('autoGenerateNextMonth')
    .timeBased()
    .onMonthDay(1)
    .atHour(1)
    .create();
    
  Logger.log("Trigger setup complete. It will run on the 1st of every month.");
}

/**
 * Automates creating new monthly ledgers and cloning 'Fixed' (Monthly) 
 * commitments and unpaid 'Target' commitments into the new month.
 */
function autoGenerateNextMonth() {
  const db = getDb();
  const folderSheet = db.getSheetByName('Folders');
  const commitSheet = db.getSheetByName('Commitments');
  
  if (!folderSheet || !commitSheet) return;
  
  const folders = getAllFolders();
  const allUsers = new Set(folders.map(f => f.owner)); // Find all unique users
  
  const now = new Date();
  
  // Backtrack to "Last Month" to see what they were working on
  let lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthLabel = `Ledger: ${lastMonthDate.toLocaleString('default', { month: 'long', year: 'numeric' })}`;
  
  // "This Month" (the newly generated month)
  const currentMonthLabel = `Ledger: ${now.toLocaleString('default', { month: 'long', year: 'numeric' })}`;
  
  // For each user
  allUsers.forEach(email => {
      const userFolders = folders.filter(f => f.owner === email);
      
      // Look for last month's ledger
      const lastMonthFolder = userFolders.find(f => f.name === lastMonthLabel);
      if (!lastMonthFolder) return; // User didn't use the app last month, nothing to carry over
      
      // Look for this month's ledger, create it if it doesn't exist
      let thisMonthFolder = userFolders.find(f => f.name === currentMonthLabel);
      if (!thisMonthFolder) {
          const newFId = 'FLD-' + Utilities.getUuid().substring(0, 8);
          // Auto carry over any SharedEmails the user had last month so they don't have to reshare
          const sharedLastMonth = lastMonthFolder.sharedWith ? lastMonthFolder.sharedWith.join(',') : '';
          folderSheet.appendRow([newFId, '', email, currentMonthLabel, sharedLastMonth]);
          thisMonthFolder = { id: newFId };
      }
      
      // Fetch commitments inside last month's folder
      const allCommData = commitSheet.getDataRange().getValues();
      for (let i = 1; i < allCommData.length; i++) {
          if (!allCommData[i][0]) continue;
          
          const rowFolderId = allCommData[i][1].toString();
          if (rowFolderId === lastMonthFolder.id) {
              
              const status = allCommData[i][5].toString();
              // Parse Type (index 8) if exists, else infer
              let type = "Fixed";
              if (allCommData[i].length > 8 && allCommData[i][8]) {
                  type = allCommData[i][8].toString();
              }
              
              // We clone items that are:
              // 1. Type: Fixed (Bill/utilities)  --> Always clone so they have it again this month
              // 2. Type: Target (Loan) AND Status: Pending --> They didn't pay it last month, carry it forward
              
              let shouldClone = false;
              if (type === 'Fixed') shouldClone = true;
              if (type === 'Target' && status === 'Pending') shouldClone = true;
              
              if (shouldClone) {
                  // Clone into New Folder as Pending
                  const newId = Utilities.getUuid();
                  
                  // Clone the exact Base64 strings (Name, Amount, Total, Balance)
                  const encodedName = allCommData[i][2];
                  const encodedAmount = allCommData[i][3];
                  
                  // For Fixed types, we might not have Total/Balance, but we copy whatever is there
                  const encodedTotal = (allCommData[i].length > 6 && allCommData[i][6]) ? allCommData[i][6] : Utilities.base64Encode(Utilities.newBlob("0").getBytes());
                  const encodedBalance = (allCommData[i].length > 7 && allCommData[i][7]) ? allCommData[i][7] : Utilities.base64Encode(Utilities.newBlob("0").getBytes());
                  
                  // Update Due Date strictly to the new month for display purposes
                  let oldDueStr = allCommData[i][4] instanceof Date ? allCommData[i][4].toISOString().split('T')[0] : allCommData[i][4].toString();
                  let newDueStr = oldDueStr;
                  if (type === 'Fixed' && oldDueStr && oldDueStr !== 'undefined' && oldDueStr !== 'null') {
                      try {
                          let d = new Date(oldDueStr);
                          d.setMonth(now.getMonth());
                          d.setFullYear(now.getFullYear());
                          newDueStr = d.toISOString().split('T')[0];
                      } catch(e) {}
                  }

                  // Preserve SharedEmails (Column J, index 9)
                  const oldSharedEmails = (allCommData[i].length > 9 && allCommData[i][9]) ? allCommData[i][9].toString() : '';

                  const newRowId = Utilities.getUuid();
                  commitSheet.appendRow([newRowId, thisMonthFolder.id, encodedName, encodedAmount, newDueStr, 'Pending', encodedTotal, encodedBalance, type, oldSharedEmails]);
              }
          }
      }
  });
}

