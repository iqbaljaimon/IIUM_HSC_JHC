// ==========================================
// VERCEL TO GOOGLE APPS SCRIPT BRIDGE
// ==========================================
const GAS_URL = "https://script.google.com/macros/s/AKfycbzvxrBiL8wvekvnoZaxWZxqLcpHiZQEiSLHOYsxW4q7Qm7VGIu0iCofOjWpDv5Q1H_sBA/exec"; 

const google = {
  script: {
    run: {
      withSuccessHandler: function(successCallback) {
        return createGasProxy(successCallback, null);
      },
      withFailureHandler: function(failureCallback) {
        return createGasProxy(null, failureCallback);
      }
    }
  }
};

function createGasProxy(successCallback, failureCallback) {
  return new Proxy({}, {
    get: function(target, functionName) {
      // Allow chaining
      if (functionName === 'withSuccessHandler') {
        return function(newSuccessCallback) { return createGasProxy(newSuccessCallback, failureCallback); };
      }
      if (functionName === 'withFailureHandler') {
        return function(newFailureCallback) { return createGasProxy(successCallback, newFailureCallback); };
      }
      
      // Execute the actual function call via HTTP POST
      return function(...args) {
        fetch(GAS_URL, {
          method: 'POST',
          body: JSON.stringify({ action: functionName, args: args })
        })
        .then(res => res.json())
        .then(res => {
          if (res.success) {
            if (successCallback) successCallback(res.data);
          } else {
            if (failureCallback) failureCallback(new Error(res.message));
            else console.error("GAS Error:", res.message);
          }
        })
        .catch(err => {
          if (failureCallback) failureCallback(err);
          else console.error("Fetch Error:", err);
        });
      };
    }
  });
}

  // --- GLOBAL VARIABLES ---
  let globalQueueData = [];
  let currentPatientData = {};
  let currentViewMode = 'day';
  let currentUser = "<?!= Session.getActiveUser().getEmail(); ?>"; 
  let currentVisitId = null;
  let pendingBookingItem = null;
  let currentUserRole = "";
  let globalPriceList = [];
  let currentBillItem = null;
  let currentBillProcedures = []; 

  // ==========================================
  // UX UTILITIES: TOASTS & AUTO-LOGOUT
  // ==========================================

  // --- 1. TOAST NOTIFICATION HELPER ---
  function showToast(message, type = 'success') {
    const toastEl = document.getElementById('liveToast');
    const toastMessage = document.getElementById('toastMessage');
    const toastIcon = document.getElementById('toastIcon');

    // Reset styles
    toastEl.className = 'toast align-items-center text-white border-0 shadow-lg';
    
    if (type === 'success') {
      toastEl.classList.add('bg-success');
      toastIcon.className = 'bi bi-check-circle-fill fs-5 me-3';
    } else if (type === 'error') {
      toastEl.classList.add('bg-danger');
      toastIcon.className = 'bi bi-x-circle-fill fs-5 me-3';
    } else if (type === 'warning') {
      toastEl.classList.add('bg-warning', 'text-dark');
      toastIcon.className = 'bi bi-exclamation-triangle-fill fs-5 me-3';
      toastEl.classList.remove('text-white');
    } else {
      toastEl.classList.add('bg-primary');
      toastIcon.className = 'bi bi-info-circle-fill fs-5 me-3';
    }

    toastMessage.innerHTML = message;
    const toast = new bootstrap.Toast(toastEl, { delay: 4000 }); // Stays for 4 seconds
    toast.show();
  }

  // --- 2. AUTO-LOGOUT ON INACTIVITY (15 Minutes) ---
  const inactivityTracker = function () {
      let time;
      const inactiveLimit = 15 * 60 * 1000; // 15 minutes in milliseconds

      // Reset timer on any of these user actions
      window.onload = resetTimer;
      document.onmousemove = resetTimer;
      document.onkeypress = resetTimer;
      document.onclick = resetTimer;
      document.ontouchstart = resetTimer;

      function logout() {
          if (currentUser) {
              // Hide App, Show Login screen
              document.getElementById('app-view').classList.add('d-none');
              document.getElementById('login-view').classList.remove('d-none');
              document.getElementById('loginPass').value = ''; // Clear password field
              
              // FIX: Force the login button to reset so you can log back in!
              const loginBtn = document.querySelector('#login-view button[type="submit"]');
              if (loginBtn) {
                  loginBtn.disabled = false;
                  loginBtn.innerHTML = "Login";
              }

              currentUser = null;
              showToast('You have been logged out due to inactivity.', 'warning');
          }
      }

      function resetTimer() {
          clearTimeout(time);
          if (currentUser) {
             time = setTimeout(logout, inactiveLimit);
          }
      }
  };
  inactivityTracker(); // Start the tracker

  // --- 1.5 GLOBAL SERVER ERROR HANDLER ---
  function handleServerFailure(error) {
      document.body.style.cursor = 'default'; // Reset cursor
      
      // Attempt to unlock any buttons that might be stuck in a "Loading..." state
      document.querySelectorAll('button:disabled').forEach(btn => {
          if (btn.innerText.includes('ing...')) {
              btn.disabled = false;
              btn.innerText = btn.getAttribute('data-original-text') || "Try Again";
          }
      });

      // Show the beautiful error toast
      showToast("Connection Error: " + error.message, "error");
      console.error("GAS Server Failed:", error);
  }

  // ==========================================
  // 1. INITIALIZATION & LOGIN
  // ==========================================
  
  document.addEventListener('DOMContentLoaded', function() {
      // Input Masking Listeners
      const icInput = document.getElementById('inp_ic');
      if(icInput) {
          icInput.addEventListener('input', function(e) {
              let val = e.target.value.replace(/\D/g, ''); 
              if (val.length > 12) val = val.slice(0, 12);
              
              if (val.length > 8) {
                  val = val.slice(0, 6) + '-' + val.slice(6, 8) + '-' + val.slice(8);
              } else if (val.length > 6) {
                  val = val.slice(0, 6) + '-' + val.slice(6);
              }
              e.target.value = val;
              
              if(val.replace(/\D/g, '').length === 12) generateMalaysianRN(val);
          });
      }

      // --- NEW: MODAL IC AUTO-FORMATTER & AGE CALCULATOR ---
      const bkIcInput = document.getElementById('bk_ic_search');
      if(bkIcInput) {
          bkIcInput.addEventListener('input', function(e) {
              let val = e.target.value.replace(/\D/g, ''); 
              if (val.length > 12) val = val.slice(0, 12);
              
              if (val.length > 8) {
                  val = val.slice(0, 6) + '-' + val.slice(6, 8) + '-' + val.slice(8);
              } else if (val.length > 6) {
                  val = val.slice(0, 6) + '-' + val.slice(6);
              }
              e.target.value = val;
              
              // Auto-calculate age instantly!
              if (val.replace(/\D/g, '').length >= 6) {
                  const ageField = document.getElementById('bk_age');
                  if(ageField) ageField.value = calculateAgeFrontend(val);
              }
          });
      }

      const phoneIds = ['inp_contact', 'inp_ecContact'];
      phoneIds.forEach(id => {
          const el = document.getElementById(id);
          if(el) {
              el.addEventListener('input', function(e) {
                  let val = e.target.value.replace(/\D/g, '');
                  if (val.length > 3) val = val.slice(0, 3) + '-' + val.slice(3);
                  e.target.value = val;
              });
          }
      }); // <--- THIS BRACKET CLOSES THE forEach LOOP HERE (Corrected)

      // --- CLOSE SEARCH RESULTS ON OUTSIDE CLICK (Fixed Bubbling) ---
      document.addEventListener('click', function(event) {
          const searchInput = document.getElementById('inp_search');
          const searchResults = document.getElementById('search-results');
          
          if (searchInput && searchResults && searchResults.style.display === 'block') {
              // Target the Search Button (which is right next to the input field)
              const searchBtn = searchInput.nextElementSibling; 
              
              // Close ONLY if click is outside the Input, Results Box, AND the Search Button
              if (!searchInput.contains(event.target) && 
                  !searchResults.contains(event.target) && 
                  !(searchBtn && searchBtn.contains(event.target))) {
                  
                  searchResults.style.display = 'none';
              }
          }
      });

      // --- ADD THIS: AUTO-UPPERCASE FOR SECTION 1 ---
      const uppercaseIds = ['inp_name', 'inp_address', 'inp_ecName', 'inp_ecRel'];
      uppercaseIds.forEach(id => {
          const el = document.getElementById(id);
          if(el) {
              el.addEventListener('input', function(e) {
                  // Save cursor position to prevent jumping
                  const start = this.selectionStart;
                  const end = this.selectionEnd;
                  this.value = this.value.toUpperCase();
                  this.setSelectionRange(start, end);
              });
          }
      });

      // --- NEW: AUTO-LOGIN FOR MOBILE APK ---
      const savedEmail = localStorage.getItem('iium_hsc_email');
      const savedPass = localStorage.getItem('iium_hsc_pass');
      
      if (savedEmail && savedPass) {
          // Fill the hidden boxes
          document.getElementById('loginEmail').value = savedEmail;
          document.getElementById('loginPass').value = savedPass;
          
          // Change the button text so the user knows it's working
          const loginBtn = document.querySelector('#login-view button[type="submit"]');
          if (loginBtn) {
              loginBtn.disabled = true;
              loginBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Auto-Logging In...';
          }
          
          // Secretly run the login function in the background
          google.script.run.withSuccessHandler(res => {
              if(res.success) {
                  currentUser = res.email;
                  currentUserRole = res.role; 
                  
                  document.getElementById('login-view').classList.add('d-none');
                  document.getElementById('app-view').classList.remove('d-none');
                  
                  let profileHtml = `${res.email}<br><span class="badge bg-secondary mt-1">${res.role}</span>`;
                  if (document.getElementById('userDisplay')) document.getElementById('userDisplay').innerHTML = profileHtml;
                  if (document.getElementById('userDisplayMobile')) document.getElementById('userDisplayMobile').innerHTML = profileHtml;
                  
                  document.getElementById('queueDate').valueAsDate = new Date();
                  document.getElementById('inp_visitDate').valueAsDate = new Date();

                  document.querySelectorAll('.sidebar .nav-item, .sidebar a.nav-link, #sidebar .nav-item').forEach(el => el.style.display = ''); 
                  
                  applyRBAC(); 
                  loadPrices();
                  
                  if (window.START_PAGE === 'rooms') {
                      showPage('rooms');
                  } else {
                      showPage('dashboard'); 
                  }
              } else {
                  // If password was changed by admin, wipe the old memory!
                  localStorage.removeItem('iium_hsc_email');
                  localStorage.removeItem('iium_hsc_pass');
              }
              
              if (loginBtn) {
                  loginBtn.disabled = false;
                  loginBtn.innerHTML = "Login";
              }
          }).loginUser(savedEmail, savedPass);
      }
      // --------------------------------------

}); // <--- THIS CLOSES DOMContentLoaded

  function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPass').value;
    const btn = e.target.querySelector('button');
    
    btn.disabled = true;
    btn.innerHTML = "Verifying...";
    document.getElementById('loginError').innerText = "";
    
    google.script.run.withSuccessHandler(res => {
      if(res.success) {
        // --- NEW: SAVE TO PHONE MEMORY ---
        localStorage.setItem('iium_hsc_email', email);
        localStorage.setItem('iium_hsc_pass', pass);
        // ---------------------------------

        currentUser = res.email;
        currentUserRole = res.role; // <--- Capture the role from the Users tab
        
        document.getElementById('login-view').classList.add('d-none');
        document.getElementById('app-view').classList.remove('d-none');
        
        // Display Role nicely under the email on BOTH menus
let profileHtml = `${res.email}<br><span class="badge bg-secondary mt-1">${res.role}</span>`;
if (document.getElementById('userDisplay')) document.getElementById('userDisplay').innerHTML = profileHtml;
if (document.getElementById('userDisplayMobile')) document.getElementById('userDisplayMobile').innerHTML = profileHtml;
        
        document.getElementById('queueDate').valueAsDate = new Date();
        document.getElementById('inp_visitDate').valueAsDate = new Date();

        document.querySelectorAll('.sidebar .nav-item, .sidebar a.nav-link, #sidebar .nav-item').forEach(el => {
            el.style.display = ''; // Removes the hardcoded 'none' from the Guest login!
        }); 
        
        applyRBAC(); // <--- TRIGGER THE SECURITY LOCKS
        loadPrices();
        
        // --- SMART ROUTER: SEND THEM TO THE REQUESTED LINK ---
        if (window.START_PAGE === 'rooms') {
            showPage('rooms'); // Teleport straight to Rooms!
        } else {
            showPage('dashboard'); 
            loadQueue(); // Only load the queue if going to the dashboard
        }
        // FIX: Reset the button silently in the background so it's ready for next time
        btn.disabled = false;
        btn.innerHTML = "Login";

      } else {
        document.getElementById('loginError').innerText = res.message;
        btn.disabled = false;
        btn.innerHTML = "Login";
      }
    }).loginUser(email, pass);
  }

  // --- GUEST LOGIN FOR JUNIOR STUDENTS (Corrected IDs) ---
function loginAsGuest() {
    try {
        currentUser = ""; 
        currentUserRole = "Guest";
        
        // 1. Hide the login screen (Using exact ID from handleLogin)
        let loginEl = document.getElementById('login-view');
        if (loginEl) loginEl.classList.add('d-none');
        
        // 2. Show the main app (Using exact ID from handleLogin)
        let appEl = document.getElementById('app-view');
        if (appEl) appEl.classList.remove('d-none');
        
        // 3. Set Profile Badges safely on BOTH menus
let guestHtml = `Guest User<br><span class="badge bg-secondary mt-1">Non-Clinical Year Student</span>`;
if (document.getElementById('userDisplay')) document.getElementById('userDisplay').innerHTML = guestHtml;
if (document.getElementById('userDisplayMobile')) document.getElementById('userDisplayMobile').innerHTML = guestHtml;
        
        
        // 4. Hide all sidebar items except Rooms and Logout
        document.querySelectorAll('.sidebar .nav-item, .sidebar a.nav-link, #sidebar .nav-item').forEach(el => {
            const text = el.innerText || "";
            if (!text.includes('Rooms') && !text.includes('Logout')) {
                el.style.display = 'none'; 
            }
        });
        
        // 5. Force them directly to the Rooms page
        if (typeof showPage === 'function') {
            showPage('rooms');
        } else {
            alert("Error: showPage function is missing or not global.");
        }
        
        // 6. Try to load the room grid safely
        try { 
            if (typeof loadRoomGrid === 'function') loadRoomGrid(); 
        } catch(e) {
            console.log("Grid load skipped: " + e.message);
        }
        
        // 7. Success message
        if (typeof showToast === 'function') {
            showToast("Logged in as Guest. Access restricted to Room Booking.", "info");
        } else {
            alert("Logged in as Guest.");
        }
        
    } catch (error) {
        alert("Guest Login Error: " + error.message);
        console.error(error);
    }
}

  // ==========================================
  // 2. NAVIGATION SYSTEM
  // ==========================================

  function hideAllSections() {
    const ids = ['page-dashboard', 'page-census', 'patient-dashboard', 'page-appointments', 'page-rooms', 'queue-container'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
  }

function showPage(pageId) {
    // 1. Hide all pages
    const allPages = document.querySelectorAll('.page-view');
    allPages.forEach(el => el.style.display = 'none');

    // 2. Remove active class from sidebar links
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));

    // 3. Find and Show Target Page
    let target = document.getElementById(pageId); 
    if (!target) target = document.getElementById('page-' + pageId); 

    if (target) {
        target.style.display = 'block';
        target.classList.remove('d-none');
    } else {
        console.error("Page ID not found: " + pageId);
    }

    // 4. TRIGGER DATA LOAD
    if (pageId === 'dashboard') {
        loadQueue();
    } else if (pageId === 'rooms') {
        const cDate = document.getElementById('checkDate');
        if (cDate && !cDate.value) cDate.valueAsDate = new Date();
        loadRoomGrid(); // <--- Now triggers the beautiful table view!
    } else if (pageId === 'appointments') { // <--- ADD THIS BLOCK
        const aDate = document.getElementById('apptGridDate');
        if (aDate && !aDate.value) aDate.valueAsDate = new Date();
        loadApptGrid();
    }
}

  function showSection(secNum) {
    document.querySelectorAll('.form-section').forEach(el => {
        el.style.display = 'none';
        el.classList.remove('active');
    });
    
    for (let i = 1; i <= 5; i++) {
        const btn = document.getElementById('btn-sec-' + i);
        if(btn) {
            btn.classList.remove('active', 'btn-primary');
            btn.classList.add('btn-outline-secondary');
        }
    }

    const sec = document.getElementById('sec-' + secNum);
    const activeBtn = document.getElementById('btn-sec-' + secNum);
    
    if(sec) {
        sec.style.display = 'block';
        sec.classList.add('active');
    }
    if(activeBtn) { 
        activeBtn.classList.remove('btn-outline-secondary');
        activeBtn.classList.add('active', 'btn-primary');
    }
    // --- NEW: TOGGLE PATIENT BANNER FOR SECTIONS 2-5 ---
    const banner = document.getElementById('census_patient_banner');
    if (banner) {
        if (secNum > 1) {
            banner.classList.remove('d-none');
            updateCensusBanner(); // Pulls the latest data from Section 1 instantly
        } else {
            banner.classList.add('d-none');
        }
    }
    // --- NEW: FORCE REFRESH FINDINGS BOXES ON MOBILE ---
    if (secNum === 4) {
        if (typeof updateFindingsTemplate === 'function') {
            updateFindingsTemplate();
        }
    }
    window.scrollTo(0,0);
}


 // --- START NEW PATIENT (SIDEBAR BUTTON) ---
function startNewPatient() {
    currentVisitId = null; 
    
    showPage('page-census'); 
    
    const form = document.getElementById('mainForm'); 
    if(form) form.reset(); 
    
    // FIX: Set Date to Today by default
    document.getElementById('inp_visitDate').valueAsDate = new Date();

    showSection(1); 
    
    if (!window.isProceedingFromDashboard) {
        currentPatientData = null;
    }
}

function handleActionIndex(status, index) {
    const item = globalQueueData[index];
    if (status === 'Checked-in') {
        if(confirm(`Mark ${item.name} as Checked-in?`)) {
             google.script.run.withSuccessHandler(loadQueue).updateQueueStatus(item.ic, status, item.date);
        }
    } else {
        startCensusFromIndex(index, 3, status);
    }
}

// --- 3. ATTENDANCE LOGIC ---
function handleAttendance(status) {
    const activeContainer = document.getElementById('container-active');
    const noshowContainer = document.getElementById('container-noshow');

    if(!activeContainer || !noshowContainer) return;

    if (status === 'Checked-in' || status === 'Confirmed') {
        activeContainer.style.display = 'block';
        activeContainer.classList.remove('d-none');
        
        noshowContainer.style.display = 'none';
        noshowContainer.classList.add('d-none');
    } else {
        activeContainer.style.display = 'none';
        activeContainer.classList.add('d-none');
        
        noshowContainer.style.display = 'block';
        noshowContainer.classList.remove('d-none');
    }
}

  // --- HIGH-SPEED SEARCH DEBOUNCER ---
  let searchTimeout;
  function triggerSmartSearch() {
      const query = document.getElementById('inp_search').value.trim();
      const container = document.getElementById('search-results');
      
      if (query.length < 2) {
          container.style.display = 'none';
          return;
      }
      
      container.style.display = 'block';
      container.innerHTML = '<div class="list-group-item text-muted"><span class="spinner-border spinner-border-sm text-primary"></span> Searching...</div>';

      // Clear the previous timer if the user is still typing
      clearTimeout(searchTimeout);
      
      // Wait 400ms after they stop typing before asking the server
      searchTimeout = setTimeout(() => {
          google.script.run.withSuccessHandler(displaySearchResults).searchPatientInDB(query);
      }, 400);
  }

  function searchDB() {
    const query = document.getElementById('inp_search').value.trim();
    const container = document.getElementById('search-results');
    
    container.style.display = 'block';

    if (query.length < 2) {
        container.innerHTML = '<div class="list-group-item text-danger">Enter 2+ characters</div>';
        return;
    }
    
    container.innerHTML = '<div class="list-group-item">Searching...</div>';
    google.script.run.withSuccessHandler(displaySearchResults).searchPatientInDB(query);
  }

  function displaySearchResults(results) {
    const container = document.getElementById('search-results');
    container.innerHTML = '';

    if (!results || results.length === 0) {
        container.innerHTML = '<div class="list-group-item text-muted">No patient found.</div>';
        return;
    }

    results.forEach(p => {
        const item = document.createElement('button');
        item.className = 'list-group-item list-group-item-action';
        item.innerHTML = `<div><strong>${p.name}</strong><br><small>IC: ${p.ic} | RN: ${p.rn}</small></div>`;
        item.onclick = function() { selectPatient(p.ic); };
        container.appendChild(item);
    });
  }

// --- 1. SELECT PATIENT (Fixed & Crash-Proof) ---
function selectPatient(ic) {
  // 1. Hide Search Results
  const results = document.getElementById('search-results');
  if(results) results.style.display = 'none';
  
  const searchInput = document.getElementById('inp_search');
  if(searchInput) searchInput.value = '';
  
  // 2. Show Wait Cursor
  document.body.style.cursor = 'wait';

  google.script.run
    .withSuccessHandler(data => {
      document.body.style.cursor = 'default';

      if(data.found) {
          currentPatientData = data; // Save for Census transfer
          
          // Fill Dashboard Demographics
          const setText = (id, txt) => { 
             const el = document.getElementById(id); 
             if(el) el.innerText = txt || '-'; 
          };

          setText('dash_name', data.name);
          setText('dash_rn', data.rn);
          setText('dash_ic', data.ic);
          setText('dash_contact', data.contact);
          setText('dash_email', data.email);
          setText('dash_age', calculateAgeFrontend(data.ic));
          setText('dash_address', currentPatientData.address);
         setText('dash_ecName', currentPatientData.ecName);
         setText('dash_ecRel', currentPatientData.ecRel);
         setText('dash_ecContact', currentPatientData.ecContact);

          // Prep the History Table
          const historyBody = document.getElementById('dash_history_body');
          const noMsg = document.getElementById('no_history_msg');

          if(historyBody) {
             historyBody.innerHTML = '<tr><td colspan="4" class="text-center p-3"><div class="spinner-border spinner-border-sm text-primary"></div> Loading history...</td></tr>';
          }
          if(noMsg) noMsg.style.display = 'none';

          // Switch Page First!
          showPage('patient-dashboard');

          // Trigger Backend Call for History
          google.script.run
            .withSuccessHandler(renderHistory)
            .withFailureHandler(handleServerFailure)
            .getPatientHistory(data.ic);

          // --- NEW: SILENTLY CHECK FOR HSP RECORD ---
          document.getElementById('hsp-alert-badge')?.remove(); // Clear old badge
          currentHSPRecord = null;
          
          google.script.run.withSuccessHandler(hspData => {
              if (hspData) {
                  currentHSPRecord = hspData;
                  // Inject a glowing badge right into the Dashboard Header
                  const dashHeader = document.querySelector('#patient-dashboard .card-header');
                  if (dashHeader) {
                      dashHeader.innerHTML += `
                        <button id="hsp-alert-badge" class="btn btn-warning btn-sm shadow fw-bold ms-auto" style="animation: pulse 2s infinite;" onclick="viewHSPDetails()">
                          <i class="bi bi-star-fill text-danger me-1"></i> HSP Record Found
                        </button>`;
                  }
              }
          }).checkHSPRecord(data.ic, data.name, data.contact);

      } else {
          showToast("Patient details not found.", "error");
      }
    })
    .withFailureHandler(handleServerFailure)
    .getPatientDetails(ic);
}

// --- 2. RENDER HISTORY TABLE (Optimized) ---
function renderHistory(history) {
  const tbody = document.getElementById('dash_history_body');
  const noMsg = document.getElementById('no_history_msg');
  
  if (!tbody) return;

  // Handle Empty History
  if (!history || history.length === 0) {
    tbody.innerHTML = ''; 
    if(noMsg) noMsg.style.display = 'block';
    return;
  }

  if(noMsg) noMsg.style.display = 'none';

  // 1. Initialize Buffer
  let htmlBuffer = '';

  // 2. Build Rows
  history.forEach(h => {
    let badgeClass = 'bg-success';
    let actionBtn = ''; 
    
    // 1. DRAFTS: Show Resume to everyone
    if (h.status === 'Draft' || h.status === 'Incomplete') { 
        badgeClass = 'bg-warning text-dark';
        actionBtn = `<div class="mt-1"><button class="btn btn-sm btn-outline-primary py-0 px-2 shadow-sm" style="font-size:0.7rem" onclick="resumeOldDraft('${currentPatientData.ic}', '${h.isoDate}')"><i class="bi bi-pencil-square"></i> Resume</button></div>`;
    } 
    // 2. COMPLETED: Show Report to everyone, but add 'Edit' for Staff/Admin
    else if (h.status === 'Completed' || h.status === 'COMPLETED') {
        actionBtn = `<div class="mt-1 d-flex gap-1 flex-wrap">
                        <button class="btn btn-sm btn-outline-dark py-0 px-2 shadow-sm" style="font-size:0.7rem" onclick="generateReportFromHistory('${currentPatientData.ic}', '${h.isoDate}', '${h.date}')"><i class="bi bi-file-earmark-pdf"></i> Report</button>`;
        
        // Security Check: Only show Edit button if NOT a student
        if (String(currentUserRole).trim().toLowerCase() !== 'student') {
            actionBtn += `<button class="btn btn-sm btn-outline-primary py-0 px-2 shadow-sm" style="font-size:0.7rem" title="Unlock & Edit" onclick="resumeOldDraft('${currentPatientData.ic}', '${h.isoDate}')"><i class="bi bi-unlock-fill"></i> Edit</button>`;
        }
        
        actionBtn += `</div>`;
    }
    
    // Truncate long text to prevent the table from stretching too far
    const truncate = (str, len) => (str && str.length > len) ? str.substring(0, len) + '...' : str;
    const escapeHTML = str => String(str).replace(/"/g, '&quot;').replace(/>/g, '&gt;');
    
    // 1. Get Full Texts (Clean procedures of manual prices)
    let fullDiag = h.diagnosis || "-";
    let fullProc = (h.procedures || "-").replace(/\[RM\s*[0-9.]+\]/g, '').trim(); 
    let fullFind = h.findings || "-";
    let fullPlan = h.nextPlan || "-";

    // 2. Get Display Texts
    let diag = truncate(fullDiag, 70);
    let proc = truncate(fullProc, 80);
    let find = truncate(fullFind, 100);
    let plan = truncate(fullPlan, 60);

    // 3. Smart Tooltip Generator (Adds dotted line only if truncated)
    const hoverStyle = (full, trunc) => {
        if (full.length > trunc.length) {
            return `title="${escapeHTML(full)}" style="cursor: help; text-decoration: underline dotted rgba(0,0,0,0.3); text-underline-offset: 3px;"`;
        }
        return `title="${escapeHTML(full)}"`;
    };

    htmlBuffer += `
      <tr>
        <td class="align-top ps-3">
            <div class="fw-bold" style="font-size:0.9rem">${h.date}</div>
            ${actionBtn}
        </td>
        <td class="align-top">
           <div class="fw-bold text-dark">${h.supervisor}</div>
        </td>
        <td class="small text-muted align-top" ${hoverStyle(fullProc, proc)}>${proc}</td>
        <td class="small text-muted align-top" style="white-space: pre-wrap;" ${hoverStyle(fullFind, find)}>${find}</td>
        <td class="small text-dark fw-bold align-top" ${hoverStyle(fullDiag, diag)}>${diag}</td>
        <td class="small text-primary fw-bold align-top" ${hoverStyle(fullPlan, plan)}>${plan}</td>
        <td class="text-center align-top">
           <span class="badge ${badgeClass}" style="font-size:0.75rem">${h.status}</span>
        </td>
      </tr>
    `;
  });
  
  // 3. Single DOM Injection
  tbody.innerHTML = htmlBuffer;
}

// ==========================================
// 4. QUEUE LOGIC (Optimized for DOM Performance)
// ==========================================
function loadQueue() {
  const dateVal = document.getElementById('queueDate').value;
  const tbody = document.getElementById('queueTableBody');
  
  // Add a nice message so users know it's syncing
  tbody.innerHTML = `<tr><td colspan="7" class="text-center p-4">
                        <div class="spinner-border text-primary mb-2"></div>
                        <div class="small fw-bold text-muted">Syncing Calendar & Fetching Queue...</div>
                     </td></tr>`;
  
  // 🔥 CHAINING FIX: Run the Auto-Sync FIRST, wait for success, THEN fetch the queue!
  google.script.run
    .withSuccessHandler(() => {
        
        // NOW ask for the queue data!
        google.script.run
          .withSuccessHandler(data => {
              if (!data || !Array.isArray(data) || data.length === 0) {
                 tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted p-4">No appointments found.</td></tr>';
                 return; 
              }

              globalQueueData = data;
              let htmlBuffer = '';

              data.forEach((item, index) => {
                  let badgeClass = 'bg-secondary'; 
                  const s = (item.status || '').toUpperCase();
                  
                  if (s.includes('CONFIRM')) badgeClass = 'bg-primary';
                  else if (s.includes('CHECK') || s.includes('ARRIV') || s.includes('COMPLET')) badgeClass = 'bg-success';
                  else if (s.includes('POSTPONE')) badgeClass = 'bg-warning text-dark';
                  else if (s.includes('CANCEL')) badgeClass = 'bg-orange';
                  else if (s.includes('NO-SHOW') || s.includes('NO SHOW')) badgeClass = 'bg-danger';

                  const age = item.age > 0 ? item.age : '-';
                  
                  let nextInfo = '-';
                  if (item.nextStatus && item.nextStatus !== '-') {
                     const dur = (item.nextDur && item.nextDur !== '-') ? item.nextDur : '';
                     const plan = (item.nextPlan && item.nextPlan !== '-') ? item.nextPlan : '';
                     const combo = [dur, plan].filter(Boolean).join(': ');
                     
                     if(item.nextStatus === 'Discharge') {
                         nextInfo = '<span class="badge bg-dark">Discharge</span>';
                     } else {
                         nextInfo = `<strong>${item.nextStatus}</strong>`;
                         if (combo) nextInfo += `<br><small class="text-primary">${combo}</small>`;
                     }
                  }

                  let rawRemarks = item.remarks || item.plan || item.visitType || '-';
                  let cleanRemarks = String(rawRemarks).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
                  let displayRemarks = cleanRemarks.replace(/\n/g, ' ').trim();
                  if (displayRemarks.length > 40) displayRemarks = displayRemarks.substring(0, 37) + '...';
                  let safeRemarks = cleanRemarks.replace(/"/g, '&quot;').replace(/>/g, '&gt;').replace(/</g, '&lt;');
                  let remarksStyle = displayRemarks.includes('...') ? 'cursor: help; text-decoration: underline dotted rgba(0,0,0,0.3); text-underline-offset: 2px;' : '';

                  let chargeDisplay = '<span class="text-muted">-</span>';
                  let chargeStr = String(item.charges || "");
                  
                  if (chargeStr.includes('HSP') || chargeStr.includes('Research')) {
                      chargeDisplay = `<span class="badge bg-info text-dark shadow-sm">${chargeStr.replace('0.00', '').trim()}</span>`;
                  } else if (item.charges && !isNaN(parseFloat(item.charges)) && parseFloat(item.charges) > 0) {
                      chargeDisplay = `<span class="text-success fw-bold">${parseFloat(item.charges).toFixed(2)}</span>`;
                  }

                  let actionBtnHtml = `<div class="d-flex justify-content-center gap-1">`;
                  let cStatus = (item.censusStatus || '').toUpperCase();
                  
                  if (cStatus === 'COMPLETED') {
                      actionBtnHtml += `<button class="btn btn-sm btn-outline-dark" onclick="generateReport(${index})" title="Print Report"><i class="bi bi-file-earmark-pdf"></i> Report</button>`;
                      if (String(currentUserRole).trim().toLowerCase() !== 'student') {
                          actionBtnHtml += `<button class="btn btn-sm btn-outline-primary" onclick="startCensusFromIndex(${index}, 1)" title="Unlock & Edit Report"><i class="bi bi-unlock-fill"></i></button>`;
                      }
                  } else {
                      actionBtnHtml += `<button class="btn btn-sm btn-primary shadow-sm" onclick="startCensusFromIndex(${index}, 3)" title="Open Clinical Census"><i class="bi bi-pencil-square"></i> Census</button>`;
                  }

                  if (String(currentUserRole).trim().toLowerCase() !== 'student') {
                      actionBtnHtml += `<button class="btn btn-sm btn-outline-primary" onclick="openBookingFromQueue(${index})" title="Set Next Appointment"><i class="bi bi-calendar-plus"></i> Appt</button>
                                        <button class="btn btn-sm btn-outline-success" onclick="openBillingModal(${index})" title="Process Payment"><i class="bi bi-currency-dollar"></i> Pay</button>`;
                  }
                  actionBtnHtml += `</div>`;

                  htmlBuffer += `
                    <tr class="align-middle">
                      <td class="text-center fw-bold text-dark" style="font-size: 0.9rem;">${item.time}</td>
                      <td class="text-start">
                         <div class="fw-bold"><a href="#" class="text-decoration-none text-primary" onclick="viewPatientDashboard(${index}); return false;">${item.name}</a></div>
                         <div class="small text-muted">${item.ic} | Age: ${age}</div>
                         <div class="small text-muted"><i class="bi bi-telephone"></i> ${item.contact}</div>
                      </td>
                      <td class="text-center">
                         <div class="small mb-1"><span class="badge bg-light text-dark border"><i class="bi bi-person-fill"></i> ${item.supervisor}</span></div>
                         <div class="small text-muted text-wrap" style="font-size:0.75rem; ${remarksStyle}" title="${safeRemarks}">${displayRemarks}</div>
                      </td>
                      <td class="text-center text-muted small">${nextInfo}</td>
                      <td class="text-center"><span class="badge ${badgeClass} shadow-sm">${item.status}</span></td>
                      <td class="text-center">${chargeDisplay}</td>
                      <td class="text-center">${actionBtnHtml}</td>
                    </tr>
                  `;
              });
              
              tbody.innerHTML = htmlBuffer;
          })
          .withFailureHandler(handleServerFailure)
          .getPatientQueue(dateVal, currentViewMode);

    })
    .withFailureHandler(handleServerFailure)
    .autoSyncCalendarStatusToDB(dateVal); // Trigger the chain!
}

// --- JUMP TO CENSUS FROM QUEUE (Crash-Proof Version) ---
function startCensusFromIndex(index, targetSection = 1, attStatus = '') {
    currentVisitId = null; 
    
    const item = globalQueueData[index];
    if(!item) return;

    const queueDateVal = document.getElementById('queueDate').value || new Date().toISOString().split('T')[0];

    document.body.style.cursor = 'wait';

    google.script.run.withSuccessHandler(function(fullData) {
        document.body.style.cursor = 'default';

        if (fullData.found) {
            currentPatientData = fullData;
            if (!currentPatientData.contact && item.contact) {
                currentPatientData.contact = item.contact;
            }
        } else {
            currentPatientData = {
                ic: item.ic, name: item.name, contact: item.contact || '', rn: '', email: '', address: ''
            };
        }

        showPage('page-census'); 
        const form = document.getElementById('mainForm');
        if(form) form.reset();
        
        // FIX 1: Completely destroy the old patient's finding boxes so they don't carry over!
        document.getElementById('dynamic-findings-container').innerHTML = ''; 
        showSection(1);

        // Helper functions
        const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };

        // --- NEW: SMART SUPERVISOR SETTER ---
        const setSup = (val) => {
            if(!val) return;
            const el = document.getElementById('inp_supervisor');
            if (el) {
                // If the supervisor from the calendar isn't in the dropdown list, add it dynamically!
                if (!Array.from(el.options).some(opt => opt.value === val)) {
                    el.add(new Option(val, val));
                }
                el.value = val;
            }
        };

        const setRadio = (name, val) => {
            if(!val) return;
            const r = document.querySelector(`input[name="${name}"][value="${val}"]`);
            if(r) r.checked = true;
        };
        const setChecks = (className, commaStr) => {
            if(!commaStr) return;
            const arr = commaStr.split(',').map(s => s.trim());
            document.querySelectorAll(`.${className}`).forEach(cb => {
                let matchedItem = arr.find(s => s === cb.value || s.startsWith(cb.value + " [RM"));
                if(matchedItem) {
                    cb.checked = true;
                    let manualMatch = matchedItem.match(/\[RM\s*([0-9.]+)\]/);
                    if (manualMatch) {
                        let input = cb.parentElement.querySelector('.manual-price-input');
                        if (input) {
                            input.style.display = 'block';
                            input.value = manualMatch[1];
                        }
                    }
                }
            });
        }; 

        const setPlanChecks = (dbStr) => {
            const standard = ["Hearing assessment", "Hearing monitoring", "Hearing aid demonstration", "Hearing aid fitting", "Hearing aid follow up", "ABR site of lesion", "ABR threshold seeking", "Cortical Auditory Evoked Potential"];
            document.querySelectorAll('.plan-chk').forEach(cb => cb.checked = false);
            
            const box = document.getElementById('box-plan-other');
            const inp = document.getElementById('inp_planOtherDetail');
            if(box) box.classList.add('d-none');
            if(inp) inp.value = '';

            if(!dbStr) return;
            
            let others = [];
            dbStr.split(',').map(s=>s.trim()).forEach(item => {
                if(standard.includes(item)) {
                    let cb = document.querySelector(`.plan-chk[value="${item}"]`);
                    if(cb) cb.checked = true;
                } else if (item) {
                    others.push(item); 
                }
            });

            if(others.length > 0) {
                document.getElementById('chkPlanOther').checked = true;
                if(box) box.classList.remove('d-none');
                if(inp) inp.value = others.join(', ');
            }
        }; 

        // 1. Fill Base Demographics
        setVal('inp_ic', currentPatientData.ic);
        setVal('inp_name', currentPatientData.name);
        setVal('inp_category', currentPatientData.category || 'Standard');
        setVal('inp_contact', currentPatientData.contact);
        setVal('inp_contact2', currentPatientData.contact2);
        setVal('inp_rn', currentPatientData.rn);
        setSup(item.supervisor);
        setVal('inp_visitDate', queueDateVal);

        applyDemographicLocks();

        // 2. RESTORE DRAFT DATA IF IT EXISTS
        if (fullData.draftData) {
            currentVisitId = fullData.draftData.visitId;

            setRadio('att', fullData.draftData.attendance);
            setRadio('tester', fullData.draftData.testerType);
            setRadio('case', fullData.draftData.caseType);
            setRadio('planStatus', fullData.draftData.planStatus);
            
            // FIX 2: Manually trigger the referral box to open if it's a "New" case
            toggleReferral(fullData.draftData.caseType === 'New'); 

            setVal('inp_noshowReason', fullData.draftData.noShowReason);
            setVal('inp_refSource', fullData.draftData.referralSource);
            setVal('inp_refOtherDetail', fullData.draftData.referralDetails);
            setVal('inp_refReason', fullData.draftData.referralReason);
            
            const setTimeDropdown = (id, dbValue) => {
                const el = document.getElementById(id);
                if (!el || dbValue === "" || dbValue === undefined || dbValue === null) return;
                const target = parseFloat(dbValue);
                if (isNaN(target)) return; 
                for (let i = 0; i < el.options.length; i++) {
                    let optVal = parseFloat(el.options[i].text || el.options[i].value);
                    if (optVal === target) {
                        el.selectedIndex = i; 
                        break;
                    }
                }
            };

            setTimeDropdown('inp_timeAlloc', fullData.draftData.allocatedTime);
            setTimeDropdown('inp_timeActual', fullData.draftData.actualTime);
            setVal('inp_timeReason', fullData.draftData.timeVariance);
            
            setVal('inp_student', fullData.draftData.studentName);
            setSup(fullData.draftData.supervisor);
            setVal('inp_history', fullData.draftData.caseHistory);
            setVal('inp_findings', fullData.draftData.findings);
            setVal('inp_diagnosis', fullData.draftData.diagnosis);
            setVal('inp_nextDur', fullData.draftData.nextDur);
            
            // FIX 3: Removed typo that caused the Section 5 crash
            setPlanChecks(fullData.draftData.nextPlan); 
            setVal('inp_remarks', fullData.draftData.remarks);
            
            if (fullData.draftData.priceCategory) setVal('inp_category', fullData.draftData.priceCategory);
            setVal('inp_discount', fullData.draftData.discount);
            setVal('inp_paymentMode', fullData.draftData.paymentMode);

            setChecks('proc-check', fullData.draftData.procedures);
            if (document.getElementById('chk_hsp')) document.getElementById('chk_hsp').checked = (fullData.draftData.isHSP === 'Yes');
            
            // Restore HSP and Research Toggles
            let savedChargeStr = String(fullData.draftData.totalCharges || "");
            if (document.getElementById('chk_hsp')) document.getElementById('chk_hsp').checked = savedChargeStr.includes('HSP');
            if (document.getElementById('chk_research')) document.getElementById('chk_research').checked = savedChargeStr.includes('Research');
            // FIX 4: Explicitly calculate prices so it doesn't show RM 0.00
            updatePrices(); 

            document.querySelectorAll('.proc-check:checked').forEach(cb => {
                if (parseFloat(cb.dataset.std) === -1) {
                    let input = cb.parentElement.querySelector('.manual-price-input');
                    if (input) input.style.display = 'block';
                }
            });

            updateFindingsTemplate();

            let draftFindings = fullData.draftData.findings || ""; 
            
            if (draftFindings) {
                document.querySelectorAll('.dynamic-finding-box').forEach(div => {
                    let proc = div.getAttribute('data-proc');
                    let regex = new RegExp(proc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ":\\n([\\s\\S]*?)(?=\\n\\n[a-zA-Z0-9 ()-]+:\\n|$)", "i");
                    let match = draftFindings.match(regex);
                    if (match && match[1]) {
                        div.querySelector('.finding-textarea').value = match[1].trim();
                        draftFindings = draftFindings.replace(match[0], "").trim(); 
                    }
                });
                
                draftFindings = draftFindings.replace(/^General Notes:\n/, '');
                setVal('inp_findings', draftFindings.trim());
            }

            if (fullData.draftData.rooms && fullData.draftData.rooms.includes('| ACTUAL TIMING:')) {
                const parts = fullData.draftData.rooms.split('| ACTUAL TIMING:');
                setChecks('room-chk', parts[0]);
                setVal('inp_roomOverride', parts[1].trim());
            } else {
                setChecks('room-chk', fullData.draftData.rooms);
            }

            setChecks('obs-room-chk', fullData.draftData.obsRooms);
            setChecks('ref-chk', fullData.draftData.referralLetters);

            const totalDisp = document.getElementById('displayTotal');
            if (totalDisp) totalDisp.innerText = fullData.draftData.totalCharges || "0.00";
        }

        // --- NEW: ALLOW DIRECT JUMPS TO ANY SECTION ---
        if (targetSection > 1) {
            setTimeout(() => {
                showSection(targetSection);
                if (attStatus) {
                    setRadio('att', attStatus);
                    if (typeof handleAttendance === "function") handleAttendance(attStatus); 
                }
            }, 50);
        }

    })
    .withFailureHandler(handleServerFailure)
    .getPatientDetails(item.ic, queueDateVal); 
}

// --- JUMP TO CENSUS FROM DASHBOARD HISTORY (Crash-Proof Version) ---
function proceedToCensus(overrideDate = null) {
    if (!currentPatientData) {
        alert("Error: No patient data selected.");
        return;
    }

    window.isProceedingFromDashboard = true;
    startNewPatient();
    window.isProceedingFromDashboard = false;

    // FIX 1: Completely destroy the old patient's finding boxes so they don't carry over!
    document.getElementById('dynamic-findings-container').innerHTML = ''; 

    const p = currentPatientData;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    
    // --- NEW: SMART SUPERVISOR SETTER ---
    const setSup = (val) => {
        if(!val) return;
        const el = document.getElementById('inp_supervisor');
        if (el) {
            if (!Array.from(el.options).some(opt => opt.value === val)) {
                el.add(new Option(val, val));
            }
            el.value = val;
        }
    };
    
    const setRadio = (name, val) => {
        if(!val) return;
        const r = document.querySelector(`input[name="${name}"][value="${val}"]`);
        if(r) r.checked = true;
    };

    const setChecks = (className, commaStr) => {
        if(!commaStr) return;
        const arr = commaStr.split(',').map(s => s.trim());
        document.querySelectorAll(`.${className}`).forEach(cb => {
            let matchedItem = arr.find(s => s === cb.value || s.startsWith(cb.value + " [RM"));
            if(matchedItem) {
                cb.checked = true;
                let manualMatch = matchedItem.match(/\[RM\s*([0-9.]+)\]/);
                if (manualMatch) {
                    let input = cb.parentElement.querySelector('.manual-price-input');
                    if (input) {
                        input.style.display = 'block';
                        input.value = manualMatch[1];
                    }
                }
            }
        });
    };

    const setPlanChecks = (dbStr) => {
        const standard = ["Hearing assessment", "Hearing monitoring", "Hearing aid demonstration", "Hearing aid fitting", "Hearing aid follow up", "ABR site of lesion", "ABR threshold seeking", "Cortical Auditory Evoked Potential"];
        document.querySelectorAll('.plan-chk').forEach(cb => cb.checked = false);
        
        const box = document.getElementById('box-plan-other');
        const inp = document.getElementById('inp_planOtherDetail');
        if(box) box.classList.add('d-none');
        if(inp) inp.value = '';

        if(!dbStr) return;
        
        let others = [];
        dbStr.split(',').map(s=>s.trim()).forEach(item => {
            if(standard.includes(item)) {
                let cb = document.querySelector(`.plan-chk[value="${item}"]`);
                if(cb) cb.checked = true;
            } else if (item) {
                others.push(item); 
            }
        });

        if(others.length > 0) {
            document.getElementById('chkPlanOther').checked = true;
            if(box) box.classList.remove('d-none');
            if(inp) inp.value = others.join(', ');
        }
    };

    // 2. AUTOFILL Demographics
    setVal('inp_ic', p.ic);
    setVal('inp_rn', p.rn);
    setVal('inp_name', p.name);
    setVal('inp_category', p.category || 'Standard');
    setVal('inp_contact', p.contact);
    setVal('inp_contact2', p.contact2);
    setVal('inp_email', p.email);
    setVal('inp_address', p.address);
    setVal('inp_ecName', p.ecName);
    setVal('inp_ecContact', p.ecContact);
    setVal('inp_ecRel', p.ecRel);

    const queueDateVal = overrideDate || document.getElementById('queueDate').value;
    if (queueDateVal) setVal('inp_visitDate', queueDateVal);

    applyDemographicLocks();

    // 3. AUTOFILL DRAFT DATA
    if (p.draftData) {
        currentVisitId = p.draftData.visitId;

        setRadio('att', p.draftData.attendance);
        setRadio('tester', p.draftData.testerType);
        setRadio('case', p.draftData.caseType);
        setRadio('planStatus', p.draftData.planStatus);
        
        // FIX 2: Reveal referral box if New Case
        toggleReferral(p.draftData.caseType === 'New'); 

        setVal('inp_noshowReason', p.draftData.noShowReason);
        setVal('inp_refSource', p.draftData.referralSource);
        setVal('inp_refOtherDetail', p.draftData.referralDetails);
        setVal('inp_refReason', p.draftData.referralReason);
        
        const setTimeDropdown = (id, dbValue) => {
            const el = document.getElementById(id);
            if (!el || dbValue === "" || dbValue === undefined || dbValue === null) return;
            const target = parseFloat(dbValue);
            if (isNaN(target)) return; 
            for (let i = 0; i < el.options.length; i++) {
                let optVal = parseFloat(el.options[i].text || el.options[i].value);
                if (optVal === target) {
                    el.selectedIndex = i; 
                    break;
                }
            }
        };

        setTimeDropdown('inp_timeAlloc', p.draftData.allocatedTime);
        setTimeDropdown('inp_timeActual', p.draftData.actualTime);
        setVal('inp_timeReason', p.draftData.timeVariance);
        
        setVal('inp_student', p.draftData.studentName);
        setSup(p.draftData.supervisor);
        setVal('inp_history', p.draftData.caseHistory);
        setVal('inp_findings', p.draftData.findings);
        setVal('inp_diagnosis', p.draftData.diagnosis);
        setVal('inp_nextDur', p.draftData.nextDur);
        
        // FIX 3: Removed typo causing crash
        setPlanChecks(p.draftData.nextPlan); 
        setVal('inp_remarks', p.draftData.remarks);
        
        if (p.draftData.priceCategory) setVal('inp_category', p.draftData.priceCategory);
        setVal('inp_discount', p.draftData.discount);
        setVal('inp_paymentMode', p.draftData.paymentMode);

        setChecks('proc-check', p.draftData.procedures);
        if (document.getElementById('chk_hsp')) document.getElementById('chk_hsp').checked = (fullData.draftData.isHSP === 'Yes');
        
        // Restore HSP and Research Toggles
            let savedChargeStr = String(fullData.draftData.totalCharges || "");
            if (document.getElementById('chk_hsp')) document.getElementById('chk_hsp').checked = savedChargeStr.includes('HSP');
            if (document.getElementById('chk_research')) document.getElementById('chk_research').checked = savedChargeStr.includes('Research');
        // FIX 4: Explicitly update prices
        updatePrices(); 

        document.querySelectorAll('.proc-check:checked').forEach(cb => {
            if (parseFloat(cb.dataset.std) === -1) {
                let input = cb.parentElement.querySelector('.manual-price-input');
                if (input) input.style.display = 'block';
            }
        });

        updateFindingsTemplate();

        let draftFindings = p.draftData.findings || ""; 
        
        if (draftFindings) {
            document.querySelectorAll('.dynamic-finding-box').forEach(div => {
                let proc = div.getAttribute('data-proc');
                let regex = new RegExp(proc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ":\\n([\\s\\S]*?)(?=\\n\\n[a-zA-Z0-9 ()-]+:\\n|$)", "i");
                let match = draftFindings.match(regex);
                if (match && match[1]) {
                    div.querySelector('.finding-textarea').value = match[1].trim();
                    draftFindings = draftFindings.replace(match[0], "").trim(); 
                }
            });
            
            draftFindings = draftFindings.replace(/^General Notes:\n/, '');
            setVal('inp_findings', draftFindings.trim());
        }

        setChecks('obs-room-chk', p.draftData.obsRooms);
        setChecks('ref-chk', p.draftData.referralLetters);

        if (p.draftData.rooms && p.draftData.rooms.includes('| ACTUAL TIMING:')) {
            const parts = p.draftData.rooms.split('| ACTUAL TIMING:');
            setChecks('room-chk', parts[0]);
            setVal('inp_roomOverride', parts[1].trim());
        } else {
            setChecks('room-chk', p.draftData.rooms);
        }

        const totalDisp = document.getElementById('displayTotal');
        if (totalDisp) totalDisp.innerText = p.draftData.totalCharges || "0.00";
    }
}

  // ==========================================
  // 5. FORM HELPERS
  // ==========================================
  function loadPrices() {
  google.script.run.withSuccessHandler(data => {
    globalPriceList = data; 
    const container = document.getElementById('procedureList');
    container.innerHTML = '';
    if (!data || !Array.isArray(data)) return;
    
    const grouped = {};
    data.forEach(item => {
        const cat = item[0] || "Uncategorized"; 
        if(!grouped[cat]) grouped[cat] = [];
        if (cat !== 'Research') grouped[cat].push(item);
    });

    Object.keys(grouped).sort().forEach((cat, i) => {
        let html = `<div class="mb-3"><h6 class="fw-bold border-bottom pb-1 text-iium">${cat}</h6>`;
        
        // --- NEW: INJECT HSP & RESEARCH TOGGLES ---
        if (cat === '1. Admin') {
            html += `
            <div class="d-flex flex-column gap-2 my-3">
                <div class="alert border-warning shadow-sm py-2 px-3 mb-0 d-flex justify-content-between align-items-center" style="background-color: #fff8e1; border-left: 4px solid #ffc107 !important;">
                   <div class="d-flex align-items-center">
                       <i class="bi bi-person-bounding-box text-warning fs-3 me-3"></i>
                       <div>
                           <strong class="text-dark d-block" style="font-size: 0.95rem;">HSP Referral Case?</strong>
                           <small class="text-muted" style="font-size: 0.75rem;">Waive standard assessment fees.</small>
                       </div>
                   </div>
                   <div class="form-check form-switch fs-4 mb-0">
                       <input class="form-check-input border-warning shadow-sm" style="cursor: pointer;" type="checkbox" id="chk_hsp" onchange="updatePrices()">
                   </div>
                </div>
                <div class="alert border-info shadow-sm py-2 px-3 mb-0 d-flex justify-content-between align-items-center" style="background-color: #e3f2fd; border-left: 4px solid #0dcaf0 !important;">
                   <div class="d-flex align-items-center">
                       <i class="bi bi-journal-medical text-info fs-3 me-3"></i>
                       <div>
                           <strong class="text-dark d-block" style="font-size: 0.95rem;">Research Subject?</strong>
                           <small class="text-muted" style="font-size: 0.75rem;">Waive assessment fees for research.</small>
                       </div>
                   </div>
                   <div class="form-check form-switch fs-4 mb-0">
                       <input class="form-check-input border-info shadow-sm" style="cursor: pointer;" type="checkbox" id="chk_research" onchange="updatePrices()">
                   </div>
                </div>
            </div>`;
        }
        
        html += `<div class="row g-2">`;
        grouped[cat].forEach((p, idx) => {
            const name = p[1];
            const std = parseFloat(p[3] || 0);
            
            let isManual = (std === -1);
            let priceText = isManual ? '' : `(RM ${std})`;
            let manualInputHtml = isManual ? `<input type="number" class="form-control form-control-sm ms-2 manual-price-input" placeholder="RM" style="width: 80px; display: none;" oninput="updatePrices()">` : '';

            html += `<div class="col-md-6 d-flex align-items-center">
              <div class="form-check flex-grow-1 d-flex align-items-center mb-1">
                <input class="form-check-input proc-check me-2 mt-0" type="checkbox" value="${name}" 
                       data-std="${std}" data-category="${cat}" onchange="toggleManualPrice(this); updatePrices(); updateFindingsTemplate();">
                <label class="form-check-label small mb-0">${name} <span class="text-muted">${priceText}</span></label>
                ${manualInputHtml}
              </div>
            </div>`;
        });
        html += `</div></div>`;
        container.innerHTML += html;
    });
  }).getPriceList();
}

  // NEW: Shows/Hides the manual price box
  function toggleManualPrice(cb) {
      const input = cb.parentElement.querySelector('.manual-price-input');
      if (input) {
          input.style.display = cb.checked ? 'block' : 'none';
          if (!cb.checked) input.value = ''; // Clear value if unchecked
      }
  }

  // UPGRADED: Calculates total based on Section 1 Category & Section 3 Toggles
  function updatePrices() {
      // 1. Check HSP & Research Status (Section 3)
      const isHSP = document.getElementById('chk_hsp')?.checked;
      const isResearch = document.getElementById('chk_research')?.checked;

      if (isHSP || isResearch) {
          let label = "0.00 ";
          if (isHSP && isResearch) label += "(HSP & Research)";
          else if (isHSP) label += "(HSP)";
          else label += "(Research)";
          
          document.getElementById('displayTotal').innerText = label;
          return;
      }

      // 2. Check Patient Category (Section 1)
      const cat = document.getElementById('inp_category').value;

      let total = 0;
      
      document.querySelectorAll('.proc-check:checked').forEach(cb => {
          let std = parseFloat(cb.dataset.std);
          
          // Manual Price Item (-1)
          if (std === -1) {
              let input = cb.parentElement.querySelector('.manual-price-input');
              let val = parseFloat(input ? input.value : 0);
              if (!isNaN(val)) total += val; // Manual prices are usually net
          } 
          // Standard Price Item
          else {
              let cost = std;
              
              // Apply Category Logic
              if (cat === 'Privileged') {
                  cost = std * 0.5; // 50% Off for Staff/Students
                  // Note: If you have specific prices for Privileged in DB, fetch that instead. 
                  // For now, I'm assuming 50% logic based on previous chats.
              } else if (cat === 'Non-Malaysian') {
                   // Exclude registration/admin fees from surcharge if needed
                   let lowerName = cb.value.toLowerCase();
                   if (!lowerName.includes('registration') && !lowerName.includes('card')) {
                       cost = std * 1.5; // 50% Surcharge
                   }
              }
              
              total += cost;
          }
      });

      document.getElementById('displayTotal').innerText = total.toFixed(2);
  }

  function handleCheckChange(cb) {
      const mid = cb.dataset.manualId;
      if(mid) {
          const inp = document.getElementById(mid);
          inp.style.display = cb.checked ? 'inline-block' : 'none';
          if(cb.checked) inp.focus(); else inp.value = '';
      }
      updatePrices();
  }

  // ==========================================
  // SMART CLINICAL FINDINGS GENERATOR (Dynamic Boxes)
  // ==========================================
  function updateFindingsTemplate() {
      const container = document.getElementById('dynamic-findings-container');
      if (!container) return;

      // 1. Save existing typed text to prevent wiping it out if they click a new checkbox!
      let existingNotes = {};
      container.querySelectorAll('.dynamic-finding-box').forEach(div => {
          let procName = div.getAttribute('data-proc');
          existingNotes[procName] = div.querySelector('textarea').value;
      });

      // 2. Identify required boxes
      const excludedCategories = ['admin', 'miscellaneous', 'hearing aid', 'accessories'];
      let procsToAdd = [];

      document.querySelectorAll('.proc-check:checked').forEach(cb => {
          let cat = (cb.getAttribute('data-category') || "").toLowerCase();
          let isExcluded = excludedCategories.some(ex => cat.includes(ex));
          
          if (!isExcluded) {
              let name = cb.value;
              name = name.replace(/\s*[-–]\s*(Diagnostic|Screening)/gi, '');
              name = name.replace(/\s*\((Diagnostic|Screening)\)/gi, '');
              name = name.trim();
              
              if (!procsToAdd.includes(name)) procsToAdd.push(name);
          }
      });

      // 3. Render beautiful individual boxes in a 2-column grid
      container.innerHTML = '';
      procsToAdd.forEach(proc => {
          let val = existingNotes[proc] || '';
          container.innerHTML += `
              <div class="col-md-6">
                  <div class="dynamic-finding-box border border-primary border-opacity-25 rounded p-2 bg-white shadow-sm h-100" data-proc="${proc}">
                      <label class="small fw-bold text-primary mb-1">${proc}</label>
                      <textarea class="form-control form-control-sm finding-textarea border-0 bg-light" rows="2" placeholder="Findings for ${proc}...">${val}</textarea>
                  </div>
              </div>
          `;
      });
  }

  function triggerUpdateCharges() {
      const total = document.getElementById('displayTotal').innerText;
      const ic = document.getElementById('inp_ic').value;
      if(!ic) { showToast("Please select a patient first.", "warning"); return; }
      
      const btn = document.getElementById('btnUpdateCharge');
      btn.innerHTML = "Updating...";
      google.script.run.withSuccessHandler(res => {
          btn.innerHTML = 'Update Queue';
          if(res) showToast("Queue Charges Updated!", "success");
          else showToast("Patient not found in queue.", "error");
      })
      .withFailureHandler(handleServerFailure)
      .updateQueueCost(ic, total);
  }

  function generateMalaysianRN(ic) {
      const rnField = document.getElementById('inp_rn');
      const clean = ic.replace(/\D/g, '');
      
      if(clean.length !== 12) {
          rnField.readOnly = false; 
          return;
      }
      
      rnField.readOnly = true;
      rnField.value = "Generating...";
      
      const mm = clean.substring(2,4);
      const last4 = clean.slice(-4);
      
      google.script.run
          .withSuccessHandler(final => {
              rnField.value = final;
          })
          .withFailureHandler(error => {
              rnField.value = ""; // Clear the stuck text
              rnField.readOnly = false; // Let user type manually
              handleServerFailure(error); // Show error toast
          })
          .generateUniqueRN(`${mm}-${last4}`);
  }

  function changeView(mode) {
      currentViewMode = mode;
      loadQueue();
  }

  function savePatientOnly() {
      const btn = document.getElementById('btnSavePatient');
      const orig = btn.innerHTML;
      const ic = document.getElementById('inp_ic').value;
      const name = document.getElementById('inp_name').value;
      
      if(!ic || !name) { showToast("IC and Name are required.", "warning"); return; }
      
      const payload = {
          ic: ic, name: name, rn: document.getElementById('inp_rn').value,
          category: document.getElementById('inp_category').value,
          contact: document.getElementById('inp_contact').value,
          contact2: document.getElementById('inp_contact2') ? document.getElementById('inp_contact2').value : '',
          email: document.getElementById('inp_email').value,
          address: document.getElementById('inp_address').value,
          ecName: document.getElementById('inp_ecName').value,
          ecContact: document.getElementById('inp_ecContact').value,
          ecRel: document.getElementById('inp_ecRel').value
      };
      
      btn.innerHTML = "Saving...";
      btn.disabled = true;
      
      google.script.run.withSuccessHandler(res => {
          btn.innerHTML = orig;
          btn.disabled = false;
          if (res.success) {
showToast("Patient details saved successfully!", "success");
} else {
showToast("Error: " + res.message, "error");
}
      })
      .withFailureHandler(handleServerFailure)
      .registerPatientOnly(payload);
  }

  function toggleReferral(isNewCase) {
    const refBox = document.getElementById('box-referral');
    if (isNewCase) {
        refBox.classList.remove('d-none');
        refBox.style.display = 'block';
    } else {
        refBox.classList.add('d-none');
        refBox.style.display = 'none';
    }
  }

  function switchToCensusPage() {
    const dashboard = document.getElementById('page-dashboard');
    if(dashboard) dashboard.style.display = 'none';
    
    const queueDiv = document.getElementById('queue-container'); 
    if(queueDiv) queueDiv.style.display = 'none';

    const censusPage = document.getElementById('page-census');
    if(censusPage) {
        censusPage.style.display = 'block';
        censusPage.classList.remove('d-none');
    }
  }

// --- 1. SEND DATE TO BACKEND & FETCH HISTORY ---
function viewPatientDashboard(index) {
    const item = globalQueueData[index];
    if(!item) return; 

    document.body.style.cursor = 'wait';

    google.script.run.withSuccessHandler(function(fullData) {
        document.body.style.cursor = 'default';
        if (!fullData) fullData = { found: false };

        if (fullData.found) {
            currentPatientData = fullData;
            // NEW FIX: Fallback to calendar contact if DB contact is empty
            if (!currentPatientData.contact && item.contact) {
                currentPatientData.contact = item.contact;
            }
        } else {
            currentPatientData = {
                ic: item.ic, name: item.name, contact: item.contact, rn: 'New', email: '-', address: '-'
            };
        }
        
        const setText = (id, txt) => { 
            const el = document.getElementById(id); 
            if(el) el.innerText = txt || '-'; 
        };
        
        setText('dash_name', currentPatientData.name);
        setText('dash_ic', currentPatientData.ic);
        setText('dash_rn', currentPatientData.rn);
        setText('dash_contact', currentPatientData.contact);
        setText('dash_email', currentPatientData.email);
        setText('dash_age', calculateAgeFrontend(currentPatientData.ic));
        setText('dash_address', currentPatientData.address);
         setText('dash_ecName', currentPatientData.ecName);
         setText('dash_ecRel', currentPatientData.ecRel);
         setText('dash_ecContact', currentPatientData.ecContact);

        // --- NEW: THE MISSING HISTORY FETCH LOGIC ---
        const historyBody = document.getElementById('dash_history_body');
        const noMsg = document.getElementById('no_history_msg');

        // 1. Show Loading Spinner
        if(historyBody) {
           historyBody.innerHTML = '<tr><td colspan="4" class="text-center p-3"><div class="spinner-border spinner-border-sm text-primary"></div> Loading history...</td></tr>';
        }
        
        // 2. Hide "No Records"
        if(noMsg) noMsg.style.display = 'none';

        // 3. Switch Page
        showPage('patient-dashboard');

        // 4. Trigger Backend Call for History
        google.script.run.withSuccessHandler(renderHistory).getPatientHistory(currentPatientData.ic);
        // --------------------------------------------

    })
    .withFailureHandler(handleServerFailure)
    .getPatientDetails(item.ic, item.isoDate);
}

function openStatusModal(index) {
    selectedQueueIndex = index;
    const modal = new bootstrap.Modal(document.getElementById('statusModal'));
    modal.show();
}

function confirmStatusChange(newStatus) {
    const item = globalQueueData[selectedQueueIndex];
    const modalEl = document.getElementById('statusModal');
    const modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();

    if (newStatus === 'Checked-in') {
        google.script.run.withSuccessHandler(loadQueue).updateQueueStatus(item.ic, newStatus, item.date);
    } else {
        startCensusFromIndex(selectedQueueIndex, 3, newStatus);
    }
}

function openSupervisorModal(index) {
    selectedQueueIndex = index;
    const item = globalQueueData[index];
    
    document.getElementById('newSupervisorSelect').value = item.supervisor || 'RR';
    
    const modal = new bootstrap.Modal(document.getElementById('supervisorModal'));
    modal.show();
}

function saveNewSupervisor() {
    const newSup = document.getElementById('newSupervisorSelect').value;
    const item = globalQueueData[selectedQueueIndex];
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('supervisorModal'));
    modal.hide();
    
    loadQueue(); 

    google.script.run.withSuccessHandler(() => {
        console.log("Supervisor Updated");
        loadQueue(); 
    })
    .withFailureHandler(handleServerFailure)
    .updateAppointmentSupervisor(item.id, newSup, item.date);
}

function setText(id, text) {
    const el = document.getElementById(id);
    if(el) el.innerText = text || '-';
}

// --- FORCE NEW VERSION: submitCensusV2 (With Smart Validation) ---
function submitCensusV2(status) {
    if (!status) status = 'Completed';
    
    // Map CounterSave to standard Draft status for the database
    let dbStatus = (status === 'CounterSave') ? 'Draft' : status;

    // Helper to get values safely
    const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    };

    // 1. SMART VALIDATION LOGIC
    let missingFields = [];
    const ic = getVal('inp_ic');
    const nextDurVal = getVal('inp_nextDur');

    // Smart Plan Compiler
    let planArr = Array.from(document.querySelectorAll('.plan-chk:checked')).map(c => c.value);
    if (planArr.includes('Other')) {
        const otherPlan = document.getElementById('inp_planOtherDetail').value.trim();
        if (otherPlan) {
            planArr[planArr.indexOf('Other')] = otherPlan; // Swap "Other" with the actual text
        } else {
            planArr = planArr.filter(p => p !== 'Other'); // Drop it if they left the box empty
        }
    }
    const nextPlanVal = planArr.join(', ');
    
    // Capture the Plan Status (Follow-up vs Discharge)
    const planStatusVal = document.querySelector('input[name="planStatus"]:checked')?.value; 

    if (!ic) missingFields.push("Patient IC");

    if (status === 'CounterSave') {
        // Counter Save only requires the absolute minimum
        if (!getVal('inp_visitDate')) missingFields.push("Date of Visit");
        if (!document.querySelector('input[name="att"]:checked')) missingFields.push("Attendance");
    }
    else if (status === 'Draft') {
        // For Drafts by Clinician, enforce the plan IF NOT DISCHARGED
        if (planStatusVal !== 'Discharge') {
            if (!nextDurVal) missingFields.push("Next Duration (Sec 5)");
            if (!nextPlanVal) missingFields.push("Next Plan (Sec 5)");
        }
    } 
    else if (status === 'Completed') {
        // Enforce ALL mandatory fields for submission
        if (!getVal('inp_name')) missingFields.push("Patient Name");
        
        if (!getVal('inp_visitDate')) missingFields.push("Date of Visit");
        
        const attendanceVal = document.querySelector('input[name="att"]:checked')?.value;
        if (!attendanceVal) missingFields.push("Attendance");
        
        // Only enforce clinical fields if the patient actually checked in
        if (attendanceVal === 'Checked-in' || attendanceVal === 'Confirmed') {
            if (!document.querySelector('input[name="tester"]:checked')) missingFields.push("Tester");
            if (!document.querySelector('input[name="case"]:checked')) missingFields.push("Case Type");
            if (!getVal('inp_timeAlloc')) missingFields.push("Allocated (Hr)");
            if (!getVal('inp_timeActual')) missingFields.push("Actual (Hr)");
            
            if (!getVal('inp_supervisor') || getVal('inp_supervisor') === 'Unassigned') missingFields.push("Supervisor");
            if (!getVal('inp_diagnosis')) missingFields.push("Diagnosis");
            
            const roomsChecked = document.querySelectorAll('.room-chk:checked').length > 0 || getVal('inp_roomOther') !== '';
            if (!roomsChecked) missingFields.push("Rooms Used");
            
            const obsChecked = document.querySelectorAll('.obs-chk:checked').length > 0 || getVal('inp_obsOther') !== '';
            if (!obsChecked) missingFields.push("Observation Room");
        }

        // Ignore Section 5 requirements if the patient is Discharged
        if (planStatusVal !== 'Discharge') {
            if (!nextDurVal) missingFields.push("Next Duration");
            if (!nextPlanVal) missingFields.push("Next Plan");
            
            const refChecked = document.querySelectorAll('.ref-chk:checked').length > 0;
            if (!refChecked) missingFields.push("Referral Letter Issued");
        }
    }

    // IF VALIDATION FAILS, STOP AND ALERT USER
    if (missingFields.length > 0) {
        showToast("Please fill required fields: " + missingFields.join(", "), "warning");
        return; 
    }

    // Visual Feedback
    let btnSec2 = document.getElementById('btnSaveProgress'); // Section 3
    let btnCounter = document.getElementById('btnSaveCounter'); // Section 2
    let btnSec5 = document.getElementById('btnSaveDraft5'); // Section 5
    let btnFinal = document.getElementById('btnSubmitFinal'); // Section 5

    if(btnSec2) btnSec2.disabled = true;
    if(btnFinal) btnFinal.disabled = true;
    
    if(btnCounter) {
        btnCounter.disabled = true;
        if(status === 'CounterSave') btnCounter.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Saving...';
    }

    if(btnSec5) {
        btnSec5.disabled = true;
        if(status === 'Draft') {
            document.getElementById('spinDraft5')?.classList.remove('d-none');
            const txt = document.getElementById('txtDraft5');
            if(txt) txt.innerText = " Saving...";
        } else if (status === 'Completed') {
            if(btnFinal) btnFinal.innerText = "Saving...";
        }
    }

    // --- LOGIC FIX: OVERRIDE ACTUAL TIME, CHARGES & TESTER ---
    const attendanceVal = document.querySelector('input[name="att"]:checked')?.value || '';
    
    // Default values from inputs
    let finalActualTime = getVal('inp_timeActual');
    let finalVariance = getVal('inp_timeReason');
    let finalTester = document.querySelector('input[name="tester"]:checked')?.value || '';

    // PROTECT CHARGES: Grab total, check if Counter already saved a protected value
    let rawCharge = document.getElementById('displayTotal')?.innerText || "0";
    let finalCharges = rawCharge; // FIX: We no longer strip text, so "(Research)" gets saved!
    
    if (currentPatientData?.draftData?.totalCharges && parseFloat(currentPatientData.draftData.totalCharges) > 0) {
        finalCharges = currentPatientData.draftData.totalCharges;
    }

    // IF NOT CHECKED-IN -> FORCE 0 TIME, 0 CHARGES, UNASSIGNED TESTER
    if (attendanceVal === 'No-show' || attendanceVal === 'Cancelled' || attendanceVal === 'Postponed') {
        finalActualTime = "0"; 
        if (!finalVariance) finalVariance = "Patient " + attendanceVal; // Auto-fill reason
        finalCharges = "0"; // Force 0 charges!
        finalTester = "Unassigned"; // Force Unassigned tester!
    }

    // 2. CAPTURE DATA 
    let refArr = Array.from(document.querySelectorAll('.ref-chk:checked')).map(c=>c.value);
    if (refArr.includes('Others')) {
        const otherDetail = getVal('inp_refOtherDetail');
        if(otherDetail) refArr.push(`(Note: ${otherDetail})`);
    }

    // 3. BUILD PAYLOAD
    const payload = {
        visitId: currentVisitId || '', 
        userEmail: currentUser, 
        ic: ic, 
        queueDateOrigin: document.getElementById('queueDate').value, 
        visitDate: getVal('inp_visitDate'), 

        name: getVal('inp_name'), 
        rn: getVal('inp_rn'),
        contact: getVal('inp_contact'), 
        contact2: getVal('inp_contact2'),
        email: getVal('inp_email'),
        address: getVal('inp_address'),
        ecName: getVal('inp_ecName'),
        ecContact: getVal('inp_ecContact'),
        ecRel: getVal('inp_ecRel'),
        category: getVal('inp_category'),
        totalCharges: finalCharges, // <--- Uses the protected charges variable
        paymentMode: currentPatientData?.draftData?.paymentMode || '',
        priceCategory: currentPatientData?.draftData?.priceCategory || '',
        discount: currentPatientData?.draftData?.discount || '',

        planStatus: document.querySelector('input[name="planStatus"]:checked')?.value || '',
        nextVisitDuration: nextDurVal, 
        planNext: nextPlanVal,         
        remarks: getVal('inp_remarks'),
        
        referralLetters: refArr, 
        referralSource: getVal('inp_refSource'), 
        referralDetails: getVal('inp_refDetails'),
        referralReason: getVal('inp_refReason'),
        
        allocatedTime: getVal('inp_timeAlloc'),
        actualTime: finalActualTime, 
        timeVariance: finalVariance,

        caseHistory: getVal('inp_history'),
        findings: (function() {
            let combined = [];
            // Gather only filled dynamic boxes
            document.querySelectorAll('.dynamic-finding-box').forEach(div => {
                // FIX: Grab the name and strip out any hidden newlines/line breaks!
                let proc = div.getAttribute('data-proc').replace(/\r?\n|\r/g, ' ').trim();
                let text = div.querySelector('.finding-textarea').value.trim();
                
                if (text) combined.push(`${proc}:\n${text}`);
            });
            // Add any general notes at the bottom
            let general = getVal('inp_findings');
            if (general) combined.push(`General Notes:\n${general}`);
            
            return combined.join('\n\n');
        })(),
        obsRooms: Array.from(document.querySelectorAll('.obs-room-chk:checked')).map(c=>c.value),

        attendance: attendanceVal, 
        noShowReason: getVal('inp_noshowReason'),
        testerType: finalTester, 
        caseType: document.querySelector('input[name="case"]:checked')?.value || '',
        studentName: getVal('inp_student'), 
        supervisor: getVal('inp_supervisor'), 
        diagnosis: getVal('inp_diagnosis'),
        procedures: Array.from(document.querySelectorAll('.proc-check:checked')).map(c => {
            let std = parseFloat(c.dataset.std);
            if (std === -1) {
                let input = c.parentElement.querySelector('.manual-price-input');
                let val = parseFloat(input ? input.value : 0) || 0;
                return `${c.value} [RM ${val}]`; // Bundles the price to save to DB
            }
            return c.value;
        }),
        rooms: (function() {
            let checked = Array.from(document.querySelectorAll('.room-chk:checked')).map(c=>c.value).join(', ');
            let other = getVal('inp_roomOther');
            let override = getVal('inp_roomOverride');
            let baseRooms = [checked, other].filter(Boolean).join(', ');
            return override ? `${baseRooms} | ACTUAL TIMING: ${override}` : baseRooms;
        })(),
        priceCategory: getVal('inp_category'), // From Section 1
        isHSP: document.getElementById('chk_hsp').checked ? 'Yes' : 'No',
        censusStatus: dbStatus // Maps perfectly to Draft or Completed for the DB
    };

    google.script.run.withSuccessHandler(function(res) {
        if (btnSec2) btnSec2.disabled = false;
        
        if (btnCounter) {
            btnCounter.disabled = false;
            btnCounter.innerHTML = '<i class="bi bi-save"></i> Save Session';
        }

        if (btnFinal) { 
            btnFinal.disabled = false; 
            btnFinal.innerText = "Submit & Complete"; 
        }

        if (btnSec5) {
            btnSec5.disabled = false;
            document.getElementById('spinDraft5')?.classList.add('d-none');
            const txt = document.getElementById('txtDraft5');
            if (txt) txt.innerHTML = '<i class="bi bi-save"></i> Save as Draft (Finish Later)';
        }
        
        if(res.success) {
            currentVisitId = res.visitId; 
            showToast(res.message, "success"); 
            
            if(status === 'Completed') {
                startNewPatient(); 
                showPage('dashboard'); // showPage automatically calls loadQueue once
            } else {
                loadQueue(); // Only refresh in the background if it's a Draft
            }
        } else {
            showToast("Error: " + res.message, "error");
        }
        
    })
    .withFailureHandler(handleServerFailure)
    .saveVisitData(payload);
}

function toggleRefOthers() {
    const chk = document.getElementById('chkRefOther');
    const box = document.getElementById('box-ref-others');
    if (chk && box) {
        if (chk.checked) {
            box.classList.remove('d-none');
            box.style.display = 'block';
        } else {
            box.classList.add('d-none');
            box.style.display = 'none';
            document.getElementById('inp_refOtherDetail').value = ''; 
        }
    }
}

function togglePlanOther() {
    const chk = document.getElementById('chkPlanOther');
    const box = document.getElementById('box-plan-other');
    if (chk && box) {
        if (chk.checked) {
            box.classList.remove('d-none');
            document.getElementById('inp_planOtherDetail').focus();
        } else {
            box.classList.add('d-none');
            document.getElementById('inp_planOtherDetail').value = ''; 
        }
    }
}

// --- RENDER WEEKLY APPT GRID (Split Pill UI & Tooltips) ---
function loadApptGrid() {
  const dateInput = document.getElementById('apptGridDate');
  if(!dateInput.value) dateInput.valueAsDate = new Date(); 
  
  const container = document.getElementById('apptGridBody');
  container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary"></div><br>Scanning Audio Tracks & Timings...</div>';

  google.script.run.withSuccessHandler(weekData => {
     if (weekData.length === 0) {
       container.innerHTML = '<div class="p-4 text-center">No slots available.</div>';
       return;
     }

     // --- NEW: DISPLAY THE ACADEMIC WEEK BANNER ---
     let fullHtml = ''; 
     if (weekData[0] && weekData[0].weekLabel) {
         fullHtml += `<div class="alert alert-warning border-warning shadow-sm py-2 mb-4 fw-bold text-center fs-5 text-dark" style="background-color: #fff3cd; letter-spacing: 1px;">
                        <i class="bi bi-calendar3-range text-warning me-2"></i> ${weekData[0].weekLabel}
                      </div>`;
     }

     weekData.forEach(day => {
         const isSelectedDate = day.dateStr === dateInput.value;
         let headerClass = isSelectedDate ? 'bg-primary text-white' : 'bg-light text-dark border-bottom border-2';
         
         // --- NEW: ADD RED BORDER IF CLINICAL EXAM ---
         let cardBorder = day.hasClinicalExam ? 'border-danger border-2' : 'border-0';
         let examBadge = day.hasClinicalExam ? `<span class="badge bg-danger shadow-sm ms-3 fs-6"><i class="bi bi-journal-medical me-1"></i> CLINICAL EXAM SCHEDULED</span>` : '';

         let tableHtml = `
             <div class="card ${cardBorder} shadow-sm mb-4">
              <div class="card-header ${headerClass} py-2 fw-bold d-flex justify-content-between align-items-center flex-wrap gap-2">
                 <div>
                     <span class="fs-6"><i class="bi bi-calendar-event me-2"></i> ${day.display}</span>
                     ${examBadge}
                 </div>
                 <div>
                     ${day.isHoliday ? `<span class="badge bg-danger">${day.holidayName}</span>` : ''}
                     ${isSelectedDate && !day.isHoliday ? '<span class="badge bg-warning text-dark shadow-sm">Selected Date</span>' : ''}
                 </div>
              </div>
              <div class="table-responsive">
                <table class="table table-borderless table-sm text-center align-middle mb-0" style="font-size: 0.8rem; border-collapse: separate; border-spacing: 0 8px;">
                  <thead class="text-muted border-bottom">
                    <tr>
                      <th style="width: 10%;">Time</th>
                      <th style="width: 30%;">Audio Slot 1</th>
                      <th style="width: 30%;">Audio Slot 2</th>
                      <th style="width: 30%;">Audio Slot 3</th>
                    </tr>
                  </thead>
                  <tbody>`;

         if (!day.isHoliday) {
             day.schedule.forEach(row => {
                tableHtml += `<tr><td class="fw-bold text-secondary">${row.time}</td>`;
                
                [1, 2, 3].forEach(sNum => {
                   const sData = row.slots[sNum];
                   
                   // Helper to render half a pill
                   const makeHalf = (slotData, isLeft) => {
                       const borderClass = isLeft ? 'border-end border-white border-opacity-50' : '';
                       if (slotData.status === 'Free') {
                           return `<div class="w-50 h-100 ${borderClass} bg-success bg-opacity-25 action-hover" 
                                     style="cursor: pointer; transition: 0.2s;" title="${slotData.exactTime} Available"
                                     onclick="openBookingModal('${day.dateStr}', '${slotData.exactTime}', ${sNum})"
                                     onmouseover="this.classList.add('bg-opacity-50')" 
                                     onmouseout="this.classList.remove('bg-opacity-50')">
                                     <i class="bi bi-plus text-success" style="line-height: 28px;"></i>
                                   </div>`;
                       } else if (slotData.status === 'Occupied') {
                           return `<div class="w-50 h-100 ${borderClass} bg-primary text-white" 
                                     style="cursor: help; line-height: 28px; font-size: 0.75rem; font-weight: bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" 
                                     title="${slotData.info}">
                                     Occ
                                   </div>`;
                       } else {
                           return `<div class="w-50 h-100 ${borderClass} bg-secondary text-white opacity-50" style="line-height: 28px; font-size: 0.7rem;">-</div>`;
                       }
                   };

                   tableHtml += `<td>
                                   <div class="d-flex mx-auto rounded-pill border border-secondary border-opacity-25 overflow-hidden shadow-sm" style="height: 28px; width: 90%;">
                                     ${makeHalf(sData.slot1, true)}
                                     ${makeHalf(sData.slot2, false)}
                                   </div>
                                 </td>`;
                });
                tableHtml += `</tr>`;
             });
         } else {
             tableHtml += `<tr><td colspan="4" class="p-4 text-center text-danger fw-bold opacity-75"><i class="bi bi-calendar-x fs-3 d-block mb-2"></i>Clinic Closed</td></tr>`;
         }

         tableHtml += `</tbody></table></div></div>`;
         fullHtml += tableHtml;
     });
     
     container.innerHTML = fullHtml;

  }).withFailureHandler(handleServerFailure).getThreeSlotGrid(dateInput.value);
}

// --- JUMP TO WEEKLY VIEW FROM QUEUE (Armored) ---
function openBookingFromQueue(index) {
  try {
      const item = globalQueueData[index];
      if(!item) return;
      
      // 1. Memorize the FULL patient item
      pendingBookingItem = item;
      
      // 2. Set the Appointment Grid date to match the queue date FIRST
      const qDate = document.getElementById('queueDate').value;
      const gridDate = document.getElementById('apptGridDate');
      if (gridDate) {
         gridDate.value = qDate || new Date().toISOString().split('T')[0];
      }

      // 3. Jump to the page!
      showPage('appointments');
      
      setTimeout(() => showToast(`Select an available time slot for ${item.name}`, "info"), 300);
  } catch(e) {
      console.error(e);
  }
}

// --- OPEN MODAL (Armored against crashes) ---
function openBookingModal(dateStr, exactTime, slotNum) {
  try {
      document.getElementById('apptForm').reset();
      document.getElementById('bk_prev_visit').innerText = '-';
      
      document.getElementById('bk_date').value = dateStr;
      document.getElementById('bk_time').value = exactTime; 
      document.getElementById('bk_slot').value = slotNum;
      document.getElementById('room-rows-container').innerHTML = '';
      
      try { addRoomRow(); } catch(err) { console.log(err); }

      // Safely open the modal
      let modalEl = document.getElementById('apptModal');
      let modal = bootstrap.Modal.getInstance(modalEl);
      if (!modal) modal = new bootstrap.Modal(modalEl);
      modal.show();
      
      try { checkApptRoomAvailability(); } catch(err) { console.log(err); }
      
      // THE MOMENT OF TRUTH: Inject data directly. NO server calls allowed here!
      if (pendingBookingItem) {
          injectPendingDataToModal(pendingBookingItem);
      }
  } catch(e) {
      showToast("System Error: " + e.message, "error");
  }
}

// --- NEW: DEDICATED PRE-FILL INJECTOR ---
function injectPendingDataToModal(item) {
  try {
      // Find the safest search term (IC, then Phone, then Name)
      let searchVal = item.ic;
      if (!searchVal || searchVal === '-' || searchVal === '') {
          searchVal = item.contact || item.name;
      }
      
      document.getElementById('bk_ic_search').value = searchVal || '';
      
      // RIGIDLY INJECT DATA (Will not be erased)
      document.getElementById('bk_name').value = item.name || '';
      document.getElementById('bk_contact').value = item.contact || '';
      document.getElementById('bk_age').value = item.age || '';
      
      // Safely check plan text for HSP flag
      let planStr = String(item.nextPlan || '');
      let isHSP = planStr.includes("HSP");
      
      document.getElementById('bk_type').value = isHSP ? 'New Case' : 'Follow-up';
      document.getElementById('bk_prev_visit').innerText = isHSP ? 'HSP Referral' : 'From Patient Queue';
      
      let qPlan = [];
      if (item.nextDur && item.nextDur !== '-') qPlan.push(item.nextDur);
      if (planStr && planStr !== '-') qPlan.push(planStr);
      
      let combinedPlan = qPlan.join(': ');
      document.getElementById('bk_plan').value = combinedPlan || '';

      showToast("✅ Patient details securely pre-filled.", "success");
  } catch(e) {
      showToast("Error filling data: " + e.message, "error");
      console.error(e);
  }
}

// --- MANUAL SEARCH (Allows New Patients) ---
function fetchPatientContext(searchTerm) {
  let cleanIC = String(searchTerm).replace(/\D/g, '');
  if (cleanIC.length < 6) {
      showToast("Please enter a valid IC number to search.", "warning");
      return;
  }
  
  const btn = document.querySelector('#apptModal .btn-primary');
  let icon = null;
  if (btn) {
      icon = btn.querySelector('i');
      if (icon) icon.className = 'spinner-border spinner-border-sm'; 
  }

  google.script.run
    .withSuccessHandler(data => {
      if (icon) icon.className = 'bi bi-search'; 
      
      if (data && data.found) {
        document.getElementById('bk_name').value = data.name || '';
        document.getElementById('bk_contact').value = data.contact || '';
        document.getElementById('bk_age').value = data.age || calculateAgeFrontend(cleanIC);
        document.getElementById('bk_type').value = data.lastCase || 'Follow-up';
        document.getElementById('bk_prev_visit').innerText = data.lastVisit || 'None';
        
        if (!document.getElementById('bk_plan').value) {
             document.getElementById('bk_plan').value = data.lastPlan || '';
        }
        showToast("Patient found and loaded!", "success");
        
      } else {
        // SMART NEW PATIENT HANDLING
        showToast("Patient not found. Proceeding as New Patient.", "info");
        document.getElementById('bk_name').value = '';
        document.getElementById('bk_contact').value = '';
        document.getElementById('bk_age').value = calculateAgeFrontend(cleanIC);
        document.getElementById('bk_type').value = 'New Case';
        document.getElementById('bk_prev_visit').innerText = 'New Patient';
      }
    })
    .withFailureHandler(error => {
        if (icon) icon.className = 'bi bi-search'; 
        handleServerFailure(error);
    })
    .getPatientContext(cleanIC);
}

// --- SUBMIT BOOKING ---
function confirmBooking() {
  // ==========================================
  // 1. STRICT PRE-FLIGHT VALIDATION CHECK
  // ==========================================
  const apptDuration = parseInt(document.getElementById('bk_duration').value) || 0;
  let totalRoomMins = 0;
  let hasError = false;

  // Scan all the dynamically added room rows
  const roomRows = document.querySelectorAll('.bk-room-name'); 

  roomRows.forEach(roomDropdown => {
      const row = roomDropdown.closest('.row');
      const rName = roomDropdown.value;
      const rTime = row.querySelector('.bk-room-time').value;
      const rDur = parseInt(row.querySelector('.bk-room-duration').value) || 0;

      if (rName && rName !== "") {
          // Check for the silent crash error (blank time)
          if (!rTime || rTime === "") {
              showToast(`⚠️ Please select a Start Time for ${rName}.`, "error");
              hasError = true;
          }
          totalRoomMins += rDur;
      }
  });

  // If a time is missing, stop the function immediately so it doesn't crash!
  if (hasError) return; 

  // Match Check: If rooms are selected, their total MUST equal the overall Appt Duration
  if (totalRoomMins > 0 && totalRoomMins !== apptDuration) {
      showToast(`⏳ Duration Mismatch! Overall Appt is ${apptDuration} mins, but your Rooms equal ${totalRoomMins} mins.`, "warning");
      return; 
  }
  // ==========================================

  // 2. Compile Multi-Room Selections (Fixed Class Names!)
  let roomList = [];
  document.querySelectorAll('.room-entry').forEach(row => {
      let r = row.querySelector('.bk-room-name').value;
      let t = row.querySelector('.bk-room-time').value;
      let d = row.querySelector('.bk-room-duration').value;
      if (r && r !== 'TBD' && t) {
          roomList.push({room: r, time: t, duration: d});
      }
  });

  // 3. Build the Payload
  const payload = {
    date: document.getElementById('bk_date').value,
    time: document.getElementById('bk_time').value,
    slot: document.getElementById('bk_slot').value,
    duration: document.getElementById('bk_duration').value, 
    roomList: roomList,  // Passes the exact rooms to the backend
    ic: document.getElementById('bk_ic_search').value.replace(/\D/g, ''), // <--- Strips dashes!
    name: document.getElementById('bk_name').value,
    contact: document.getElementById('bk_contact').value,
    age: document.getElementById('bk_age').value,
    supervisor: document.getElementById('bk_sup').value,
    apptType: document.getElementById('modalApptType').value,
    caseType: document.getElementById('bk_type').value,
    plan: document.getElementById('bk_plan').value,
    prevVisit: document.getElementById('bk_prev_visit').innerText,
    status: 'Pending',
    userEmail: currentUser
  };

  if(!payload.ic || !payload.name) {
    showToast("Please enter patient details.", "warning");
    return;
  }

  const btn = document.getElementById('btnBookConfirm');
  btn.disabled = true;
  btn.innerText = "Checking Availability...";

  // 4. Send to Backend
  google.script.run.withSuccessHandler(res => {
    btn.disabled = false;
    btn.innerText = "Confirm Booking";
    
    if (res.success) {
      const modal = bootstrap.Modal.getInstance(document.getElementById('apptModal'));
      modal.hide();
      loadApptGrid(); 
      showToast("Appointment Booked Successfully!", "success");
    } else {
      showToast("Booking Failed: " + res.message, "error"); 
    }
  })
  .withFailureHandler(handleServerFailure)
  .saveAppointment(payload);
}

// --- LOAD WEEKLY ROOM GRID ---
let globalWeeklyRoomData = [];

// --- LOAD COMPACT VERTICAL WEEKLY GRID (Hide Non-Office Hours) ---
function loadRoomGrid() {
  const dateInput = document.getElementById('checkDate');
  if (!dateInput.value) dateInput.valueAsDate = new Date();
  
  const container = document.getElementById('weekly-room-container');
  container.innerHTML = '<div class="text-center p-5"><div class="spinner-border text-primary"></div><br>Fetching Weekly Matrix...</div>';

  google.script.run.withSuccessHandler(weekData => {
     let fullHtml = '';
     const roomKeys = ["Cabin 1", "Cabin 2", "Cabin 3", "Cabin 4", "Cabin 5", "Cabin 6", "Room 7", "Room 8", "Room 9"];
     const shortNames = ["C1", "C2", "C3", "C4", "C5", "C6", "R7", "R8", "R9"];

     weekData.forEach(day => {
         const isSelectedDate = day.dateStr === dateInput.value;
         const dObj = new Date(day.dateStr);
         const isWeekend = (dObj.getDay() === 0 || dObj.getDay() === 6);
         
         let headerClass = isSelectedDate ? 'bg-iium text-white' : 'bg-secondary text-white';
         if (isWeekend && !isSelectedDate) headerClass = 'bg-light text-secondary border-bottom';

         let tableHtml = `
            <div class="card border-0 shadow-sm mb-4">
              <div class="card-header ${headerClass} py-2 fw-bold d-flex justify-content-between align-items-center">
                 <span><i class="bi bi-calendar-event me-2"></i> ${day.display}</span>
                 ${isSelectedDate ? '<span class="badge bg-warning text-dark shadow-sm">Selected Date</span>' : ''}
              </div>
              <div class="card-body p-0 table-responsive">
                <table class="table table-bordered table-sm text-center align-middle mb-0" style="font-size: 0.75rem;">
                  <thead class="bg-light"><tr><th style="width: 10%;">Time</th>`;
         
         shortNames.forEach((sn, i) => { tableHtml += `<th style="width: 10%;" title="${roomKeys[i]}">${sn}</th>`; });
         tableHtml += `</tr></thead><tbody>`;

         // THE MAGIC: Rendering the Split Cells with Office-Hour Classes
         day.schedule.forEach(row => {
            // Check if time is 8am to 4pm (16:xx ends at 5pm)
            let h = parseInt(row.time.split(':')[0]);
            if (row.time.includes('PM') && h !== 12) h += 12;
            if (row.time.includes('AM') && h === 12) h = 0;
            
            // Hidden by default if before 8am or after 4pm (16:00)
            const isOfficeHour = (h >= 8 && h <= 16); 
            const rowClass = isOfficeHour ? "office-hour" : "non-office-hour d-none bg-light";

            tableHtml += `<tr class="${rowClass}"><td class="fw-bold text-muted">${row.time}</td>`;
            roomKeys.forEach(rName => {
               const rData = row.rooms[rName];
               const makeHalf = (slotData, isLeft) => {
                   const borderClass = isLeft ? 'border-end border-secondary border-opacity-25' : '';
                   if (slotData.status === 'Free') {
                       return `<div class="w-50 h-100 ${borderClass} bg-white action-hover" 
                                    style="cursor: pointer; transition: 0.2s;" title="${slotData.exactTime} Available"
                                    onclick="startBooking('${rName}', '${slotData.exactTime}', '${day.dateStr}')"
                                    onmouseover="this.classList.add('bg-success', 'bg-opacity-25')" 
                                    onmouseout="this.classList.remove('bg-success', 'bg-opacity-25')">
                                    <i class="bi bi-plus text-success" style="line-height: 24px;"></i>
                               </div>`;
                   } else if (slotData.status === 'Occupied') {
                       return `<div class="w-50 h-100 ${borderClass} bg-danger text-white" style="cursor: help; line-height: 24px; font-size: 0.65rem; font-weight: bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${slotData.info}">Occ</div>`;
                   } else {
                       return `<div class="w-50 h-100 ${borderClass} bg-warning text-dark" style="cursor: help; line-height: 24px; font-size: 0.65rem; font-weight: bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${slotData.info}">Pnd</div>`;
                   }
               };

               tableHtml += `<td class="p-1 align-middle">
                               <div class="d-flex mx-auto rounded-pill border border-secondary border-opacity-25 overflow-hidden shadow-sm" style="height: 26px; width: 100%;">
                                 ${makeHalf(rData.slot1, true)}${makeHalf(rData.slot2, false)}
                               </div>
                             </td>`;
            });
            tableHtml += `</tr>`;
         });

         tableHtml += `</tbody></table>
            <button class="btn btn-light w-100 py-2 border-top fw-bold text-secondary" style="font-size:0.8rem" 
                    onclick="this.previousElementSibling.querySelectorAll('.non-office-hour').forEach(el => el.classList.toggle('d-none')); this.innerText = this.innerText.includes('Show') ? 'Hide After-Office Hours' : 'Show Expanded Hours';">
               Show Expanded Hours (7 AM - 11 PM)
            </button>
         </div></div>`;
         fullHtml += tableHtml;
     });

     container.innerHTML = fullHtml;

  }).withFailureHandler(handleServerFailure).getRoomWeeklyGrid(dateInput.value);
}

// --- NEW: DIM OCCUPIED ROOMS IN APPOINTMENT MODAL ---
function checkApptRoomAvailability() {
    const date = document.getElementById('bk_date').value;
    const time = document.getElementById('bk_time').value;
    const dur = document.getElementById('bk_duration').value;
    
    if (!date || !time || !dur) return;

    google.script.run.withSuccessHandler(occupiedRooms => {
        document.querySelectorAll('.bk-room-name').forEach(select => {
            Array.from(select.options).forEach(opt => {
                if (opt.value && occupiedRooms.includes(opt.value)) {
                    opt.disabled = true;
                    opt.text = opt.value + " (Occupied)";
                    opt.style.color = "red";
                } else if (opt.value) {
                    opt.disabled = false;
                    opt.text = opt.value;
                    opt.style.color = "";
                }
            });
        });
    }).getOccupiedRooms(date, time, dur);
}

// 1. Initial Load
function initRoomDashboard() {
  document.getElementById('roomCheckDate').valueAsDate = new Date();
  loadRoomStatus();
}

// 2. Fetch & Render
function loadRoomStatus() {
  const dateVal = document.getElementById('roomCheckDate').value;
  const grid = document.getElementById('roomStatusGrid');
  
  grid.innerHTML = '<div class="col-12 text-center p-5"><div class="spinner-border text-primary"></div><br>Checking schedules...</div>';

  google.script.run.withSuccessHandler(map => {
     // Define Rooms Layout
     const rooms = [
       { id: "Cabin 1", type: "Cabin" }, { id: "Cabin 2", type: "Cabin" },
       { id: "Cabin 3", type: "Cabin" }, { id: "Cabin 4", type: "Cabin" },
       { id: "Cabin 5", type: "Cabin" }, { id: "Cabin 6", type: "Cabin" },
       { id: "Room 7", type: "Room" },   { id: "Room 8", type: "Room" },
       { id: "Room 9", type: "Room" }
     ];

     let htmlBuffer = ''; // 1. Initialize Buffer

     rooms.forEach(r => {
        let status = map[r.id] || 'Free'; // Default Free
        let cardClass = 'border-success bg-success bg-opacity-10';
        let icon = 'bi-check-circle-fill text-success';
        let text = 'Available';

        if (status === 'Clinic Use' || status === 'Approved') {
           cardClass = 'border-danger bg-danger bg-opacity-10';
           icon = 'bi-x-circle-fill text-danger';
           text = 'Occupied';
        } else if (status === 'Pending') {
           cardClass = 'border-warning bg-warning bg-opacity-10';
           icon = 'bi-exclamation-circle-fill text-warning';
           text = 'Pending Request';
        }

        htmlBuffer += `
          <div class="col-md-4 col-sm-6">
            <div class="card h-100 shadow-sm border-start border-4 ${cardClass}">
              <div class="card-body d-flex justify-content-between align-items-center">
                 <div>
                    <h5 class="fw-bold mb-0">${r.id}</h5>
                    <small class="text-muted">${r.type}</small>
                 </div>
                 <div class="text-end">
                    <i class="bi ${icon} fs-3"></i>
                    <div class="small fw-bold mt-1">${text}</div>
                 </div>
              </div>
            </div>
          </div>
        `;
     });
     
     // 2. Single DOM Injection
     grid.innerHTML = htmlBuffer;
     
  })
  .withFailureHandler(handleServerFailure)
  .getRoomStatus(dateVal);
}

// --- LOAD DAILY VIEW (Optimized with HTML Buffering) ---
function loadDailyView() {
  const dateInput = document.getElementById('dailyDate');
  if(!dateInput.value) dateInput.valueAsDate = new Date();
  
  const container = document.getElementById('dailyGridBody');
  container.innerHTML = '<tr><td colspan="4" class="p-5 text-center"><div class="spinner-border text-primary"></div><br>Syncing with Calendar...</td></tr>';
  
  google.script.run.withSuccessHandler(rows => {
    
    if (!rows || rows.length === 0) {
      container.innerHTML = '<tr><td colspan="4" class="p-5 text-center text-muted">Clinic is Closed / No slots generated.</td></tr>';
      return;
    }

    // 1. Initialize Buffer
    let dailyHtmlBuffer = '';

    rows.forEach(row => {
      const buildCell = (slotId, data) => {
        if (data) {
          // BOOKED CELL
          let badgeColor = 'bg-primary'; 
          if(data.status.includes('CANCEL') || data.status.includes('NO')) badgeColor = 'bg-danger';
          else if(data.status.includes('CHECK')) badgeColor = 'bg-success';
          
          let displayInfo = data.patient.length > 25 ? data.patient.substring(0,22)+"..." : data.patient;

          // DIRECT LINK
          return `
            <div class="card shadow-sm border-start border-4 border-primary p-2 text-start position-relative h-100" 
                 style="background:#f8f9fa; cursor:pointer; transition:0.2s;" 
                 onclick="selectPatient('${data.ic}')"
                 onmouseover="this.style.background='#e9ecef'" 
                 onmouseout="this.style.background='#f8f9fa'">
              
              <div class="fw-bold text-dark small mb-1">${displayInfo}</div>
              
              <div class="d-flex justify-content-between align-items-center">
                <span class="badge bg-secondary text-white" style="font-size:0.65rem">
                   ${data.supervisor} ${data.age ? `(${data.age}yo)` : ''}
                </span>
                <span class="badge ${badgeColor}" style="font-size:0.65rem">${data.status}</span>
              </div>
            </div>`;
        } else {
          // FREE CELL
          return `
            <button class="btn btn-outline-success w-100 py-2 border-dashed opacity-50" 
              style="font-size:0.8rem"
              onclick="openBookingModal('${dateInput.value}', '${row.display}', ${slotId})">
              <i class="bi bi-plus-lg"></i>
            </button>`;
        }
      };

      // 2. Append to Buffer
      dailyHtmlBuffer += `
        <tr>
          <td class="bg-light fw-bold text-secondary small align-middle">${row.display}</td>
          <td class="p-1 align-top" style="height:60px">${buildCell(1, row.slots[1])}</td>
          <td class="p-1 align-top" style="height:60px">${buildCell(2, row.slots[2])}</td>
          <td class="p-1 align-top" style="height:60px">${buildCell(3, row.slots[3])}</td>
        </tr>`;
    });
    
    // 3. Single DOM Injection
    container.innerHTML = dailyHtmlBuffer;

  })
  .withFailureHandler(handleServerFailure)
  .getDailyViewData(dateInput.value);
}

// ==========================================
// NAVIGATION HELPER: Search to Dashboard
// ==========================================
function loadPatientFromSearch(ic) {
    // Because we previously upgraded selectPatient, it now handles 
    // the page switching, loading spinners, and history fetching automatically!
    selectPatient(ic);
}

// ==========================================
// ADVANCED CASE STUDY SEARCH LOGIC
// ==========================================
function executeAdvancedSearch() {
  // Gather filters
  const filters = {
      type: document.getElementById('flt_type').value.toLowerCase(),
      degree: document.getElementById('flt_degree').value.toLowerCase(),
      site: document.getElementById('flt_site').value.toLowerCase(),
      keyword: document.getElementById('flt_keyword').value.toLowerCase().trim()
  };

  // Check if at least one filter is active
  if (!filters.type && !filters.degree && !filters.site && filters.keyword.length < 2) {
      showToast("Please select a filter or enter a 2+ letter keyword.", "warning");
      return;
  }

  const container = document.getElementById('case-search-results');
  container.innerHTML = '<div class="col-12 text-center p-5"><div class="spinner-border text-primary" style="width: 3rem; height: 3rem;"></div><h5 class="mt-3 text-muted">Scanning Audiological Profiles...</h5></div>';

  google.script.run.withSuccessHandler(results => {
      if (!results || results.length === 0) {
          container.innerHTML = `<div class="col-12 text-center p-5 text-muted">
                                   <i class="bi bi-folder-x fs-1"></i><br>
                                   <h5>No cases found matching these criteria.</h5>
                                 </div>`;
          return;
      }

      showToast(`Found ${results.length} matching cases!`, "success");
      
      let htmlBuffer = ''; // 1. Initialize Buffer

      results.forEach((r, idx) => {
          let highlightedDiag = r.diagnosis;
          if (filters.type) highlightedDiag = highlightedDiag.replace(new RegExp(filters.type, "gi"), match => `<mark>${match}</mark>`);
          if (filters.degree) highlightedDiag = highlightedDiag.replace(new RegExp(filters.degree, "gi"), match => `<mark class="bg-warning">${match}</mark>`);

          htmlBuffer += `
            <div class="col-12">
              <div class="card shadow-sm border-start border-4 border-primary">
                <div class="card-header bg-white d-flex justify-content-between align-items-center py-3">
                  <div>
                    <h5 class="mb-0 fw-bold">
                      <a href="#" class="text-primary text-decoration-none" onclick="loadPatientFromSearch('${r.ic}'); return false;" title="Open Patient Dashboard">
                        ${r.name} <i class="bi bi-box-arrow-up-right ms-2 small"></i>
                      </a>
                    </h5>
                    <div class="small text-muted">
                      <strong>IC:</strong> ${r.ic} | <strong>Contact:</strong> ${r.contact} | <strong>Date:</strong> ${r.date} 
                      <span class="badge bg-secondary ms-2">${r.tabSource}</span>
                    </div>
                  </div>
                  <button class="btn btn-sm btn-outline-primary" type="button" data-bs-toggle="collapse" data-bs-target="#collapseCase${idx}">
                    View Clinical Details <i class="bi bi-chevron-down"></i>
                  </button>
                </div>
                
                <div id="collapseCase${idx}" class="collapse">
                  <div class="card-body bg-light">
                    <div class="row g-3">
                      <div class="col-md-12">
                         <div class="p-3 bg-white border rounded shadow-sm">
                           <h6 class="text-primary fw-bold border-bottom pb-2">Diagnosis</h6>
                           <p class="mb-0 fs-5 text-dark">${highlightedDiag}</p>
                         </div>
                      </div>
                      <div class="col-md-6">
                         <div class="p-3 bg-white border rounded h-100 shadow-sm">
                           <h6 class="text-primary fw-bold border-bottom pb-2">Case History</h6>
                           <p class="mb-0 small" style="white-space: pre-wrap;">${r.history}</p>
                         </div>
                      </div>
                      <div class="col-md-6">
                         <div class="p-3 bg-white border rounded h-100 shadow-sm">
                           <h6 class="text-primary fw-bold border-bottom pb-2">Findings</h6>
                           <p class="mb-0 small" style="white-space: pre-wrap;">${r.findings}</p>
                         </div>
                      </div>
                      <div class="col-md-6">
                         <div class="p-3 bg-white border rounded shadow-sm">
                           <h6 class="text-primary fw-bold border-bottom pb-2">Referral Context</h6>
                           <ul class="mb-0 small list-unstyled">
                              <li><strong>Source:</strong> ${r.refSource}</li>
                              <li><strong>Reason:</strong> ${r.refReason}</li>
                              <li><strong>Letters:</strong> ${r.refLetters}</li>
                           </ul>
                         </div>
                      </div>
                      <div class="col-md-6">
                         <div class="p-3 bg-white border rounded shadow-sm">
                           <h6 class="text-primary fw-bold border-bottom pb-2">Next Plan</h6>
                           <p class="mb-0 small fw-bold text-success">${r.plan}</p>
                         </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          `;
      });
      
      // 2. Single DOM Injection
      container.innerHTML = htmlBuffer;

  })
  .withFailureHandler(handleServerFailure)
  .searchCasesAdvanced(filters);
}

// ==========================================
// ROLE-BASED ACCESS CONTROL (RBAC)
// ==========================================
function applyRBAC() {
    const role = String(currentUserRole).trim().toLowerCase();

    // 1. SIDEBAR RESTRICTIONS
    if (role === 'student') {
        // Hide Appointments for students
        if (document.getElementById('nav-appointments')) document.getElementById('nav-appointments').style.display = 'none';
        if (document.getElementById('nav-appointments-mob')) document.getElementById('nav-appointments-mob').style.display = 'none';
    } else {
        // Show Appointments for Admin/Staff
        if (document.getElementById('nav-appointments')) document.getElementById('nav-appointments').style.display = 'block';
        if (document.getElementById('nav-appointments-mob')) document.getElementById('nav-appointments-mob').style.display = 'block';
    }

    // ALWAYS show Rooms for EVERYONE so students can submit requests!
    if (document.getElementById('nav-rooms')) document.getElementById('nav-rooms').style.display = 'block';
    if (document.getElementById('nav-rooms-mob')) document.getElementById('nav-rooms-mob').style.display = 'block';

    // Show Analytics only for Admin (Desktop & Mobile)
    const isAdmin = (role === 'admin');
    const analyticsNav = document.getElementById('nav-analytics');
    const analyticsNavMob = document.getElementById('nav-analytics-mob');
    if (analyticsNav) analyticsNav.style.display = isAdmin ? 'block' : 'none';
    if (analyticsNavMob) analyticsNavMob.style.display = isAdmin ? 'block' : 'none';

    // Restrict HSP Analytics to Admin and Staff only (Desktop & Mobile)
    const isNotStudent = (role !== 'student');
    const hspNavItem = document.getElementById('nav-hsp-analytics');
    const hspNavItemMob = document.getElementById('nav-hsp-analytics-mob');
    if (hspNavItem) hspNavItem.style.display = isNotStudent ? 'block' : 'none';
    if (hspNavItemMob) hspNavItemMob.style.display = isNotStudent ? 'block' : 'none';

    // 2. CENSUS FORM RESTRICTIONS (Section 1: Demographics)
    // Students can view but cannot edit the core patient identity data.
    const isStudent = (role === 'student');
    const sec1Inputs = ['inp_ic', 'inp_name', 'inp_contact', 'inp_email', 'inp_address', 'inp_ecName', 'inp_ecContact', 'inp_ecRel'];
    
    sec1Inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.readOnly = isStudent;
            if (isStudent) {
                el.classList.add('bg-light'); // Visually indicate it is locked
            } else {
                el.classList.remove('bg-light'); // Unlock for Admin/Staff
            }
        }
    });

    // Hide the "Save/Update Data" button for Section 1 if Student
    const savePatBtn = document.getElementById('btnSavePatient');
    if (savePatBtn) {
        savePatBtn.style.display = isStudent ? 'none' : 'inline-block';
    }

    // *Note: Section 2 (Payment/Billing) restrictions have been intentionally removed.*
    // *Students are allowed full access to practice clinical charging.*
}

function toggleDiscountReason() {
    const val = document.getElementById('bill_discount').value;
    const div = document.getElementById('div_discount_reason');
    const input = document.getElementById('bill_discount_reason');
    
    if (val === 'Yes') {
        div.classList.remove('d-none');
        input.focus();
    } else {
        div.classList.add('d-none');
        input.value = ''; // Clear it if they switch back to No
    }
}

// ==========================================
// BILLING MODAL LOGIC (Counter Workflow)
// ==========================================
function openBillingModal(index) {
    const item = globalQueueData[index];
    currentBillItem = item;
    
    // Reset modal UI
    document.getElementById('bill_category').value = 'Standard';
    document.getElementById('bill_discount').value = 'No';
    document.getElementById('div_discount_reason').classList.add('d-none'); // <--- NEW: Hide reason box
    document.getElementById('bill_discount_reason').value = '';
    document.getElementById('bill_mode').value = 'Cash';
    document.getElementById('bill_procedures').innerHTML = '<span class="spinner-border spinner-border-sm text-primary"></span> Fetching records...';
    document.getElementById('bill_total').innerText = '0.00';
    
    const modal = new bootstrap.Modal(document.getElementById('billingModal'));
    modal.show();

    // Fetch the draft/completed visit to see what the Clinician ticked
    google.script.run.withSuccessHandler(data => {
        let procs = [];
        if (data.draftData && data.draftData.procedures) {
            procs = data.draftData.procedures.split(',').map(s => s.trim()).filter(Boolean);
            
            // Pre-fill existing billing choices if Assistant already set them earlier
            if (data.draftData.priceCategory) document.getElementById('bill_category').value = data.draftData.priceCategory;
            if (data.draftData.discount) document.getElementById('bill_discount').value = data.draftData.discount;
            if (data.draftData.paymentMode) document.getElementById('bill_mode').value = data.draftData.paymentMode;
        }
        currentBillProcedures = procs;
        
        if (procs.length === 0) {
            document.getElementById('bill_procedures').innerHTML = '<span class="text-warning small"><i class="bi bi-exclamation-triangle"></i> No procedures selected yet. Ask Clinician to complete Section 3.</span>';
        } else {
            document.getElementById('bill_procedures').innerHTML = procs.map(p => `<span class="badge bg-secondary me-1 mb-1">${p}</span>`).join('');
        }
       
       // NEW: Auto-fill the Read-Only Category from DB
       let dbCategory = data.category || 'Standard';
       document.getElementById('bill_category').value = dbCategory;
       
       // If HSP was toggled in Section 3, we might want to visually indicate it here too
       // (Optional, but helpful)
       if (data.draftData && data.draftData.isHSP === 'Yes') {
           document.getElementById('bill_category').value = dbCategory + " (HSP Covered)";
       }

       calcBillingTotal(); // Recalculate totals based on this loaded category
   }).withFailureHandler(handleServerFailure).getPatientDetails(item.ic, item.isoDate);
}

function calcBillingTotal() {
    const cat = document.getElementById('bill_category').value;
    const disc = document.getElementById('bill_discount').value;
    let total = 0;
    let manualTotal = 0; // Tracks prices immune to discounts
    
    if (currentBillProcedures && currentBillProcedures.length > 0) {
        currentBillProcedures.forEach(procString => {
            // 1. EXTRACT MANUAL PRICE IF IT EXISTS
            let manualMatch = procString.match(/\[RM\s*([0-9.]+)\]/);
            if (manualMatch) {
                manualTotal += parseFloat(manualMatch[1]) || 0;
                return; // STOP! Do not apply category rules to this item.
            }
            
            // 2. STANDARD PRICE LOGIC
            const p = globalPriceList.find(item => item[1] === procString);
            if(p) {
                let cost = parseFloat(p[3] || 0); // Standard
                if(cat === 'Privileged') cost = parseFloat(p[2] || 0);
                if(cat === 'HSP') cost = 0;
                
                // NON-MALAYSIAN EXCLUSION LOGIC
                let lowerName = procString.toLowerCase();
                let isExcluded = lowerName.includes('registration') || 
                                 lowerName.includes('appointment card') || 
                                 lowerName.includes('professional');
                                 
                if(cat === 'Non-Malaysian' && !isExcluded) {
                    cost *= 1.5;
                }
                total += cost;
            }
        });
    }
    
    // Apply 10% discount ONLY to the standard total
    if(disc === 'Yes') total *= 0.9;
    
    // ADD THE FIXED MANUAL PRICES AT THE END
    let grandTotal = total + manualTotal;
    document.getElementById('bill_total').innerText = grandTotal.toFixed(2);
}

function saveBilling() {
    const btn = document.getElementById('btnSaveBilling');
    btn.disabled = true;
    btn.innerText = "Saving...";

    const payload = {
        ic: currentBillItem.ic,
        date: currentBillItem.isoDate,
        category: document.getElementById('bill_category').value,
        discount: document.getElementById('bill_discount').value,
        discountReason: document.getElementById('bill_discount_reason').value,
        mode: document.getElementById('bill_mode').value,
        total: document.getElementById('bill_total').innerText
    };

    google.script.run.withSuccessHandler(res => {
        btn.disabled = false;
        btn.innerText = "Save Payment Record";
        const modal = bootstrap.Modal.getInstance(document.getElementById('billingModal'));
        modal.hide();
        showToast("Payment Details Saved Successfully!", "success");
        loadQueue(); // Refresh queue to show updated green price
    }).withFailureHandler(handleServerFailure).saveBillingStatus(payload);
}

// ==========================================
// MULTI-ROOM BOOKING LOGIC (With Smart Time Auto-Fill)
// ==========================================
function addRoomRow() {
    const container = document.getElementById('room-rows-container');
    if (container.children.length >= 3) {
        showToast("Maximum of 3 rooms allowed per appointment.", "warning");
        return;
    }
    
    // --- 1. SMART TIME CALCULATOR ---
    let defaultTime = "";
    const existingRows = container.querySelectorAll('.room-entry');

    if (existingRows.length === 0) {
        // 1st Room: Grab the main appointment start time
        defaultTime = document.getElementById('bk_time').value;
    } else {
        // 2nd/3rd Room: Do the math based on the previous room's time + duration
        const lastRow = existingRows[existingRows.length - 1];
        const lastTime = lastRow.querySelector('.bk-room-time').value;
        const lastDur = lastRow.querySelector('.bk-room-duration').value;

        if (lastTime && lastDur) {
            let [hours, minutes] = lastTime.split(':').map(Number);
            let totalMins = (hours * 60) + minutes + parseInt(lastDur);
            
            let newHours = Math.floor(totalMins / 60);
            let newMins = totalMins % 60;
            
            // Format back to HH:MM
            defaultTime = String(newHours).padStart(2, '0') + ':' + String(newMins).padStart(2, '0');
        } else {
            // Fallback if previous row was somehow left blank
            defaultTime = document.getElementById('bk_time').value; 
        }
    }

    // --- 2. DYNAMIC DROPDOWN BUILDER ---
    const timeOptions = [
        {val: "", label: "Start Time..."},
        {val: "08:00", label: "08:00 AM"}, {val: "08:30", label: "08:30 AM"},
        {val: "09:00", label: "09:00 AM"}, {val: "09:30", label: "09:30 AM"},
        {val: "10:00", label: "10:00 AM"}, {val: "10:30", label: "10:30 AM"},
        {val: "11:00", label: "11:00 AM"}, {val: "11:30", label: "11:30 AM"},
        {val: "12:00", label: "12:00 PM"}, {val: "12:30", label: "12:30 PM"},
        {val: "14:00", label: "02:00 PM"}, {val: "14:30", label: "02:30 PM"},
        {val: "15:00", label: "03:00 PM"}, {val: "15:30", label: "03:30 PM"},
        {val: "16:00", label: "04:00 PM"}, {val: "16:30", label: "04:30 PM"},
        {val: "17:00", label: "05:00 PM"}, {val: "17:30", label: "05:30 PM"}
    ];

    let timeSelectHtml = `<select class="form-select form-select-sm bk-room-time border-primary">`;
    timeOptions.forEach(opt => {
        // Automatically select the calculated time
        let isSelected = (opt.val === defaultTime) ? "selected" : "";
        timeSelectHtml += `<option value="${opt.val}" ${isSelected}>${opt.label}</option>`;
    });
    timeSelectHtml += `</select>`;

    // --- 3. RENDER THE ROW ---
    const row = document.createElement('div');
    row.className = 'row g-1 mb-2 align-items-center room-entry';
    row.innerHTML = `
        <div class="col-4">
           <select class="form-select form-select-sm bk-room-name border-primary">
             <option value="">- Select -</option>
             <option value="Cabin 1">Cabin 1</option>
             <option value="Cabin 2">Cabin 2</option>
             <option value="Cabin 3">Cabin 3</option>
             <option value="Cabin 4">Cabin 4</option>
             <option value="Cabin 5">Cabin 5</option>
             <option value="Cabin 6">Cabin 6</option>
             <option value="Room 7">Room 7</option>
             <option value="Room 8">Room 8</option>
             <option value="Room 9">Room 9</option>
           </select>
        </div>
        <div class="col-4">
           ${timeSelectHtml}
        </div>
        <div class="col-3">
           <select class="form-select form-select-sm bk-room-duration border-info">
             <option value="30">30 Mins</option>
             <option value="60" selected>1 Hour</option>
             <option value="90">1.5 Hours</option>
             <option value="120">2 Hours</option>
             <option value="150">2.5 Hours</option>
             <option value="180">3 Hours</option>
           </select>
        </div>
        <div class="col-1 text-center d-flex align-items-center">
           <i class="bi bi-x-circle text-danger" style="cursor: pointer;" onclick="this.closest('.row').remove()" title="Remove Room"></i>
        </div>
    `;
    container.appendChild(row);
}

// ==========================================
// UI HELPER: PATIENT BANNER & AGE CALC
// ==========================================
function calculateAgeFrontend(ic) {
    const clean = String(ic).replace(/\D/g, '');
    if(clean.length < 6) return '-';
    let year = parseInt(clean.substring(0,2));
    let currentYear = new Date().getFullYear() % 100;
    let fullYear = (year > currentYear) ? 1900 + year : 2000 + year;
    return new Date().getFullYear() - fullYear;
}

function updateCensusBanner() {
    const name = document.getElementById('inp_name').value || 'Unknown Patient';
    const ic = document.getElementById('inp_ic').value || '-';
    const rn = document.getElementById('inp_rn').value || '-';
    const age = calculateAgeFrontend(ic);

    const setText = (id, txt) => { const el = document.getElementById(id); if(el) el.innerText = txt; };
    setText('hdr_name', name);
    setText('hdr_ic', ic);
    setText('hdr_rn', rn);
    setText('hdr_age', age);
}

// ==========================================
// SECURE CLINICAL REPORT GENERATOR
// ==========================================
function generateReport(index) {
    const item = globalQueueData[index];
    if(!item) return;

    document.body.style.cursor = 'wait';
    showToast("Decrypting & Loading Secure View...", "info");

    google.script.run.withSuccessHandler(fullData => {
        document.body.style.cursor = 'default';
        
        if (!fullData || !fullData.draftData) {
            showToast("Cannot generate report: No clinical data found.", "error");
            return;
        }

        const d = fullData.draftData;
        
        // 1. Populate Meta Data
        document.getElementById('rpt_name').innerText = fullData.name || item.name;
        document.getElementById('rpt_ic').innerText = fullData.ic || item.ic;
        document.getElementById('rpt_rn').innerText = fullData.rn || '-';
        document.getElementById('rpt_age').innerText = calculateAgeFrontend(fullData.ic || item.ic);
        document.getElementById('rpt_date').innerText = item.displayDate || document.getElementById('queueDate').value;
        document.getElementById('rpt_supervisor').innerText = d.supervisor || '-';
        document.getElementById('rpt_sign_name').innerText = d.supervisorFullName || d.supervisor || 'Supervisor';
        // Handle Student Clinician Signature (Bottom Left)
        const stuBlock = document.getElementById('rpt_student_signature_block');
        const stuNameBottom = document.getElementById('rpt_student_bottom');
        if (d.studentName && d.studentName.toUpperCase() !== 'NA' && d.studentName.toUpperCase() !== 'N/A') {
            stuNameBottom.innerText = d.studentName;
            stuBlock.style.display = 'block'; // Reveal the left signature block
        } else {
            stuBlock.style.display = 'none'; // Keep it hidden
        }

        // 2. Populate Clinical Text
        document.getElementById('rpt_history').innerText = d.caseHistory || 'No history recorded.';
        document.getElementById('rpt_diagnosis').innerText = d.diagnosis || 'No diagnosis recorded.';
        
        let planText = `Status: ${d.planStatus || '-'}\n`;
        if (d.nextDur && d.nextDur !== '-') planText += `Next Visit: ${d.nextDur}\n`;
        if (d.nextPlan && d.nextPlan !== '-') planText += `Plan: ${d.nextPlan}\n`;
        document.getElementById('rpt_plan').innerText = planText;

        let findingsRaw = d.findings || 'No findings recorded.';
        // Upgraded Auto-Bolder: Catches ALL characters (like /, &, commas) before the colon
        // Bulletproof Auto-Bolder: Splits blocks and guarantees the whole procedure name is bolded, ignoring hidden newlines!
        let formattedFindings = findingsRaw.split('\n\n').map(block => {
            let parts = block.split(/:\n/);
            if(parts.length > 1) {
                let procName = parts[0].replace(/\n/g, ' ').trim(); // Flattens any broken lines into one line
                let content = parts.slice(1).join(':\n'); // Rejoin the rest
                return `<strong>${procName}:</strong>\n${content}`;
            }
            return block;
        }).join('\n\n');
        document.getElementById('rpt_findings').innerHTML = formattedFindings;

        // 3. APPLY DYNAMIC WATERMARK
        const now = new Date();
        document.getElementById('wm_user').innerText = currentUser;
        document.getElementById('wm_time').innerText = now.toLocaleDateString() + " " + now.toLocaleTimeString();

        // 4. SHOW SECURE VIEWER & APPLY ROLE-BASED LOCKS
        document.getElementById('secure-report-view').classList.remove('d-none');
        document.body.style.overflow = 'hidden'; 
        
        const role = String(currentUserRole).trim().toLowerCase();
        const printBtn = document.getElementById('btn-print-report');

        if (role === 'student') {
            // STRICT LOCKDOWN FOR STUDENTS
            document.body.classList.add('print-restricted');
            document.body.classList.remove('print-allowed');
            printBtn.classList.add('d-none');
            
            document.addEventListener('contextmenu', preventDefaultAction); 
            document.addEventListener('keydown', preventShortcuts); 
        } else {
            // ADMIN / STAFF ACCESS
            document.body.classList.remove('print-restricted');
            document.body.classList.add('print-allowed'); // Tells CSS to print cleanly
            printBtn.classList.remove('d-none'); // Reveal the Print Button
            
            // We DO NOT attach the contextmenu/keyboard blocks for Admins
        }

    }).withFailureHandler(handleServerFailure).getPatientDetails(item.ic, item.isoDate);
}

// ==========================================
// SECURE REPORT GENERATOR (From History Table)
// ==========================================
function generateReportFromHistory(ic, isoDate, displayDate) {
    document.body.style.cursor = 'wait';
    showToast("Decrypting & Loading Secure View...", "info");

    google.script.run.withSuccessHandler(fullData => {
        document.body.style.cursor = 'default';
        
        if (!fullData || !fullData.draftData) {
            showToast("Cannot generate report: No clinical data found for this date.", "error");
            return;
        }

        const d = fullData.draftData;
        
        // 1. Populate Meta Data (Using currentPatientData for fallbacks)
        document.getElementById('rpt_name').innerText = fullData.name || currentPatientData.name;
        document.getElementById('rpt_ic').innerText = fullData.ic || ic;
        document.getElementById('rpt_rn').innerText = fullData.rn || currentPatientData.rn || '-';
        document.getElementById('rpt_age').innerText = calculateAgeFrontend(fullData.ic || ic);
        document.getElementById('rpt_date').innerText = displayDate;
        document.getElementById('rpt_supervisor').innerText = d.supervisor || '-';
        document.getElementById('rpt_sign_name').innerText = d.supervisorFullName || d.supervisor || 'Supervisor';
        // Handle Student Clinician Signature (Bottom Left)
        const stuBlock = document.getElementById('rpt_student_signature_block');
        const stuNameBottom = document.getElementById('rpt_student_bottom');
        if (d.studentName && d.studentName.toUpperCase() !== 'NA' && d.studentName.toUpperCase() !== 'N/A') {
            stuNameBottom.innerText = d.studentName;
            stuBlock.style.display = 'block'; // Reveal the left signature block
        } else {
            stuBlock.style.display = 'none'; // Keep it hidden
        }

        // 2. Populate Clinical Text
        document.getElementById('rpt_history').innerText = d.caseHistory || 'No history recorded.';
        document.getElementById('rpt_diagnosis').innerText = d.diagnosis || 'No diagnosis recorded.';
        
        let planText = `Status: ${d.planStatus || '-'}\n`;
        if (d.nextDur && d.nextDur !== '-') planText += `Next Visit: ${d.nextDur}\n`;
        if (d.nextPlan && d.nextPlan !== '-') planText += `Plan: ${d.nextPlan}\n`;
        document.getElementById('rpt_plan').innerText = planText;

        // 3. Format the Findings beautifully (Bulletproof Auto-Bolder)
        let findingsRaw = d.findings || 'No findings recorded.';
        let formattedFindings = findingsRaw.split('\n\n').map(block => {
            let parts = block.split(/:\n/);
            if(parts.length > 1) {
                let procName = parts[0].replace(/\n/g, ' ').trim(); 
                let content = parts.slice(1).join(':\n'); 
                return `<strong>${procName}:</strong>\n${content}`;
            }
            return block;
        }).join('\n\n');
        document.getElementById('rpt_findings').innerHTML = formattedFindings;

        // 4. APPLY DYNAMIC WATERMARK
        const now = new Date();
        document.getElementById('wm_user').innerText = currentUser;
        document.getElementById('wm_time').innerText = now.toLocaleDateString() + " " + now.toLocaleTimeString();

        // 5. SHOW SECURE VIEWER & APPLY ROLE-BASED LOCKS
        document.getElementById('secure-report-view').classList.remove('d-none');
        document.body.style.overflow = 'hidden'; 
        
        const role = String(currentUserRole).trim().toLowerCase();
        const printBtn = document.getElementById('btn-print-report');

        if (role === 'student') {
            // STRICT LOCKDOWN FOR STUDENTS
            document.body.classList.add('print-restricted');
            document.body.classList.remove('print-allowed');
            printBtn.classList.add('d-none');
            
            document.addEventListener('contextmenu', preventDefaultAction); 
            document.addEventListener('keydown', preventShortcuts); 
        } else {
            // ADMIN / STAFF ACCESS
            document.body.classList.remove('print-restricted');
            document.body.classList.add('print-allowed'); 
            printBtn.classList.remove('d-none'); 
        }

    }).withFailureHandler(handleServerFailure).getPatientDetails(ic, isoDate);
}

function closeSecureReport() {
    // Hide Viewer & Reset Scrolling
    document.getElementById('secure-report-view').classList.add('d-none');
    document.body.style.overflow = 'auto'; 
    
    // Completely wipe all security states so the rest of the app functions normally
    document.body.classList.remove('print-restricted');
    document.body.classList.remove('print-allowed');
    document.removeEventListener('contextmenu', preventDefaultAction);
    document.removeEventListener('keydown', preventShortcuts);
}

// Security Helper Functions
function preventDefaultAction(e) {
    e.preventDefault();
}

function preventShortcuts(e) {
    // Blocks Ctrl+P (Print), Ctrl+S (Save), Ctrl+C (Copy), Ctrl+Shift+S (Screenshot)
    if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'p' || key === 's' || key === 'c') {
            e.preventDefault();
            showToast("Action blocked due to patient confidentiality.", "warning");
        }
    }
}

// ==========================================
// RESUME OLD DRAFT (From History Table)
// ==========================================
function resumeOldDraft(ic, isoDate) {
    document.body.style.cursor = 'wait';
    showToast("Fetching old draft...", "info");

    google.script.run.withSuccessHandler(function(fullData) {
        document.body.style.cursor = 'default';
        
        if (fullData && fullData.draftData) {
            currentPatientData = fullData; // Update global state
            proceedToCensus(isoDate); // Pass the historical date to force the form into the past!
            showToast("Draft loaded successfully.", "success");
        } else {
            showToast("Could not locate the saved draft data in the database.", "error");
        }
    })
    .withFailureHandler(handleServerFailure)
    .getPatientDetails(ic, isoDate); // Ask backend for the specific date
}

// ==========================================
// MANUAL LOGOUT
// ==========================================
function performLogout() {
    // --- NEW: WIPE PHONE MEMORY ---
    localStorage.removeItem('iium_hsc_email');
    localStorage.removeItem('iium_hsc_pass');
    // ------------------------------
    
    // 1. Clear user data
    currentUser = null;
    currentUserRole = "";
    
    // 2. Hide App and Show Login Screen instantly
    document.getElementById('app-view').classList.add('d-none');
    document.getElementById('login-view').classList.remove('d-none');
    
    // 3. Clear the password field for security
    document.getElementById('loginPass').value = ''; 
    
    // 4. Reset the login button
    const loginBtn = document.querySelector('#login-view button[type="submit"]');
    if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.innerHTML = "Login";
    }
    
    // 5. Hide mobile menu if it is open
    const mobileMenu = document.getElementById('mobileMenu');
    if (mobileMenu && mobileMenu.classList.contains('show')) {
        const bsOffcanvas = bootstrap.Offcanvas.getInstance(mobileMenu);
        if (bsOffcanvas) bsOffcanvas.hide();
    }

    // 6. Show confirmation
    showToast('You have been securely logged out.', 'success');
}

// ==========================================
// ROLE-BASED DEMOGRAPHIC LOCKS
// ==========================================
function applyDemographicLocks() {
    const role = String(currentUserRole).trim().toLowerCase();
    const isAdmin = (role === 'admin');
    
    // If the patient has no name yet, they are a brand new registration. 
    // We allow editing here so walk-ins can still be registered by staff if needed!
    const isNewPatient = !currentPatientData || !currentPatientData.name || currentPatientData.name.trim() === ''; 
    const canEdit = isAdmin || isNewPatient;

    // 1. Lock Text Fields (Read-Only allows copying text, but no typing)
    const textFields = ['inp_name', 'inp_rn', 'inp_contact', 'inp_email', 'inp_address', 'inp_ecName', 'inp_ecRel', 'inp_ecContact'];
    
    textFields.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.readOnly = !canEdit;
            if (!canEdit) {
                el.classList.add('bg-light'); // Turns grey to show it's locked
            } else {
                el.classList.remove('bg-light');
            }
        }
    });

    // 2. Lock the Category Dropdown (Dropdowns use 'disabled')
    const catField = document.getElementById('inp_category');
    if (catField) {
        catField.disabled = !canEdit;
    }
}

// ==========================================
// BULLETPROOF PRINT FUNCTION (Bypasses Google Sandbox)
// ==========================================
function printReportDiv() {
    const reportElement = document.getElementById('secure-paper');
    if (!reportElement) return;

    // 1. Create a hidden iframe strictly for printing
    let printFrame = document.createElement('iframe');
    printFrame.name = "printFrame";
    printFrame.style.position = 'absolute';
    printFrame.style.top = '-9999px';
    printFrame.style.left = '-9999px';
    document.body.appendChild(printFrame);

    // 2. Build the HTML content for the iframe (Cloning your exact report styles)
    const content = reportElement.innerHTML;
    
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>IIUM HSC Report</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            <style>
                body { background-color: white; color: black; padding: 20px; font-family: Arial, sans-serif; -webkit-print-color-adjust: exact; }
                .report-header { text-align: center; margin-bottom: 15px; border-bottom: 2px solid #007a7e; padding-bottom: 10px;}
                .report-header img { width: 90px; margin-bottom: 5px; } 
                .report-header h3 { font-size: 1.25rem !important; margin: 0 !important; font-weight: bold; color: #333; }
                .report-header h5 { font-size: 0.95rem !important; margin: 2px 0 0 0 !important; color: #666; font-weight: normal; }
                .report-meta-table { width: 100%; margin-bottom: 15px; font-size: 0.85rem; border-collapse: collapse; table-layout: auto; }
                .report-meta-table td { padding: 4px 5px; border-bottom: 1px solid #eee; }
                .report-meta-label { font-weight: bold; width: 18%; min-width: 120px; color: #555; white-space: nowrap; }
                .report-section { margin-bottom: 15px; position: relative; z-index: 2; }
                .report-section h5 { color: #007a7e; font-weight: bold; font-size: 0.95rem; border-bottom: 1px solid #ccc; padding-bottom: 3px; margin-bottom: 5px; text-transform: uppercase;}
                .report-text { white-space: pre-wrap; font-size: 0.85rem; line-height: 1.4; margin-bottom: 0;}
                
                /* Hide buttons and watermark on the printed paper */
                .watermark-layer { display: none !important; }
                .hide-on-print { display: none !important; }
            </style>
        </head>
        <body>
            ${content}
        </body>
        </html>
    `;

    // 3. Write the content into the hidden iframe
    const doc = printFrame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    // 4. Wait for styles/images to load, then trigger the print dialogue
    setTimeout(() => {
        printFrame.contentWindow.focus();
        printFrame.contentWindow.print();
        
        // Clean up the iframe after printing is done
        setTimeout(() => {
            document.body.removeChild(printFrame);
        }, 1000);
    }, 750); // 750ms delay ensures the IIUM logo and CSS load perfectly before printing
}

// ==========================================
// HSP DATABASE FRONTEND LOGIC
// ==========================================

function triggerHSPSearch() {
    try {
        const inputEl = document.getElementById('hsp_search_input');
        if (!inputEl) return;
        
        const query = inputEl.value.trim();
        if (query.length < 3) {
            showToast("Enter at least 3 characters to search.", "warning");
            return;
        }
        
        // Find the button and activate the spinner
        const searchBtn = inputEl.nextElementSibling;
        if (searchBtn) {
            searchBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
            searchBtn.disabled = true;
        }

        google.script.run.withSuccessHandler(results => {
            // 1. Instantly stop the spinner
            if (searchBtn) {
                searchBtn.innerHTML = 'Search';
                searchBtn.disabled = false;
            }

            try {
                // 2. BUILD THE MODAL OUT OF THIN AIR IF IT DOESN'T EXIST!
                let modalEl = document.getElementById('dynamicHspSearchModal');
                if (!modalEl) {
                    modalEl = document.createElement('div');
                    modalEl.id = 'dynamicHspSearchModal';
                    modalEl.className = 'modal fade';
                    modalEl.setAttribute('tabindex', '-1');
                    modalEl.innerHTML = `
                        <div class="modal-dialog modal-lg modal-dialog-centered">
                            <div class="modal-content border-0 shadow">
                                <div class="modal-header bg-iium text-white">
                                    <h5 class="modal-title fw-bold"><i class="bi bi-search"></i> HSP Search Results</h5>
                                    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                                </div>
                                <div class="modal-body bg-light p-4" id="dynamicHspSearchBody">
                                   </div>
                            </div>
                        </div>
                    `;
                    document.body.appendChild(modalEl);
                }

                const modalBody = document.getElementById('dynamicHspSearchBody');

                // 3. INJECT THE RESULTS
                if (!results || results.length === 0) {
                    modalBody.innerHTML = `<div class="text-center p-5 text-muted">
                                             <i class="bi bi-folder-x fs-1 mb-2 d-block"></i>
                                             <h5>No HSP records found for "${query}".</h5>
                                           </div>`;
                    showToast("No matching records found.", "warning");
                } else {
                    let html = '<div class="row g-3">';
                    results.forEach(r => html += buildHSPCard(r, true)); // true = Include Book Appt Button
                    html += '</div>';
                    modalBody.innerHTML = html;
                    
                    // If only 1 patient is found, make the card take up the full screen elegantly
                    if (results.length === 1) {
                        modalBody.querySelectorAll('.col-md-6').forEach(el => el.className = 'col-12');
                    }
                    showToast(`Found ${results.length} HSP records!`, "success");
                }
                
                // 4. POP IT OPEN!
                const myModal = new bootstrap.Modal(modalEl);
                myModal.show();

            } catch(e) {
                showToast("UI Error: " + e.message, "error");
            }
            
        }).withFailureHandler(err => {
            // Stop spinner on server error
            if (searchBtn) {
                searchBtn.innerHTML = 'Search';
                searchBtn.disabled = false;
            }
            handleServerFailure(err);
        }).searchHSPDatabase(query);
        
    } catch(e) {
        showToast("System Error: " + e.message, "error");
    }
}

// Global variable to hold a loaded HSP record for the Clinical view
let currentHSPRecord = null; 

function buildHSPCard(r, isSearchPage = false) {
    let resultColor = r.overall === 'PASS' ? 'success' : (r.overall === 'REFER' ? 'danger' : 'warning');
    let resultIcon = r.overall === 'PASS' ? 'check-circle' : (r.overall === 'exclamation-circle');

    // Helper to only render pills if data exists
    const pill = (label, right, left) => {
        if (!right && !left) return '';
        let txt = '';
        if (right) txt += `R: ${right} `;
        if (left) txt += `| L: ${left}`;
        return `<span class="badge bg-white text-dark border shadow-sm p-2 mb-1 me-1"><small class="text-primary fw-bold">${label}:</small> ${txt}</span>`;
    };
    
    const singlePill = (label, val) => {
        if (!val) return '';
        return `<span class="badge bg-white text-dark border shadow-sm p-2 mb-1 me-1"><small class="text-primary fw-bold">${label}:</small> ${val}</span>`;
    };

    let testHtml = pill('Otoscopy', r.otoR, r.otoL) +
                   pill('Tymp', r.tympR, r.tympL) +
                   pill('OAE', r.oaeR, r.oaeL) +
                   singlePill('DTT', r.dttRes) +
                   singlePill('iLAMP', r.ilampRes);

    if(!testHtml) testHtml = '<span class="text-muted small">No specific test results available.</span>';

    // Action Button Logic: If they are on the search page AND result is REFER
    let actionBtn = '';
    if (isSearchPage && r.overall === 'REFER') {
        let safeData = encodeURIComponent(JSON.stringify({ic: r.ic, name: r.name, contact: r.contact, age: r.age}));
        actionBtn = `
          <button class="btn btn-primary w-100 shadow fw-bold mt-3" onclick="bookFromHSP('${safeData}')">
             <i class="bi bi-calendar-plus me-1"></i> Book Diagnostic Appt
          </button>`;
    }

    return `
      <div class="col-md-6 col-lg-4">
        <div class="card h-100 shadow-sm border-start border-4 border-${resultColor}">
          <div class="card-body p-4">
            <div class="d-flex justify-content-between align-items-start mb-2">
               <h5 class="fw-bold text-dark mb-0">${r.name}</h5>
               <span class="badge bg-${resultColor} fs-6 shadow-sm"><i class="bi bi-${resultIcon}"></i> ${r.overall}</span>
            </div>
            <div class="small text-muted mb-3 border-bottom pb-3">
               <strong>IC:</strong> ${r.ic} | <strong>Age:</strong> ${r.age}<br>
               <strong>Contact:</strong> ${r.contact} <br>
               <strong>Parent/Guardian:</strong> ${r.parent}
            </div>
            
            <div class="bg-light p-2 rounded mb-3 small">
               <i class="bi bi-geo-alt-fill text-danger me-1"></i> <strong>${r.venue}</strong><br>
               <i class="bi bi-calendar-event-fill text-primary me-1"></i> Date: ${r.date}
            </div>

            <div class="mb-3">
               <h6 class="fw-bold text-secondary border-bottom pb-1 small text-uppercase">Case Summary</h6>
               <p class="small text-dark mb-0" style="white-space: pre-wrap;">${r.comments}</p>
            </div>

            <div class="mb-0">
               <h6 class="fw-bold text-secondary border-bottom pb-1 small text-uppercase">Tests Conducted</h6>
               <div class="d-flex flex-wrap">${testHtml}</div>
            </div>
            
            ${actionBtn}
          </div>
        </div>
      </div>
    `;
}

// Triggers the modal from the Patient Dashboard or Census
function viewHSPDetails() {
    if (!currentHSPRecord) return;
    document.getElementById('hspSummaryBody').innerHTML = `<div class="row">` + buildHSPCard(currentHSPRecord, false) + `</div>`;
    // Remove the column constraints to let it take full width of the modal
    document.getElementById('hspSummaryBody').querySelector('.col-md-6').className = 'col-12'; 
    new bootstrap.Modal(document.getElementById('hspSummaryModal')).show();
}

// Teleports Clinic Assistant to booking page with data prefilled
function bookFromHSP(encodedData) {
    const data = JSON.parse(decodeURIComponent(encodedData));
    
    showPage('appointments');
    document.getElementById('apptGridDate').valueAsDate = new Date();
    loadApptGrid(); // Load today's grid
    
    // Auto-fill the floating pending variable so the modal catches it instantly
    pendingBookingItem = { ic: data.ic, name: data.name, contact: data.contact, age: data.age, nextPlan: "Diagnostic Assessment (HSP Referral)" };
    
    showToast(`Select an available slot for ${data.name}`, "info");
}

// ==========================================
// HSP DASHBOARD LOGIC (Call List & Stats)
// ==========================================
let globalHSPData = null;

// Hook this into the navigation router!
const originalShowPage = showPage;
showPage = function(pageId) {
    originalShowPage(pageId); // Call your existing router
    if (pageId === 'hsp') {
        loadHSPDashboard(); // Auto-load when clicked!
    }
};

function loadHSPDashboard() {
    google.script.run.withSuccessHandler(res => {
        if (!res.success) { showToast(res.message, "error"); return; }
        
        globalHSPData = res;
        
        // Populate Semester Dropdown
        const semSelect = document.getElementById('hsp_filter_sem');
        semSelect.innerHTML = '<option value="">-- All Semesters --</option>' + 
                              res.semesters.map(sem => `<option value="${sem}">${sem}</option>`).join('');
        
        updateHSPVenues(); // This will now render BOTH the table and the stats!
        
    }).withFailureHandler(handleServerFailure).getHSPDashboardData();
}

function updateHSPVenues() {
    if (!globalHSPData) return;
    
    const sem = document.getElementById('hsp_filter_sem').value;
    const venueSelect = document.getElementById('hsp_filter_venue');
    
    if (!sem) {
        venueSelect.innerHTML = '<option value="">-- All Venues --</option>';
        document.getElementById('hsp_venue_date_display').innerText = "Viewing overall referral list.";
    } else {
        const venues = Object.keys(globalHSPData.venues[sem] || {}).sort();
        venueSelect.innerHTML = '<option value="">-- All Venues in Sem --</option>' + 
                                venues.map(v => `<option value="${v}">${v}</option>`).join('');
        document.getElementById('hsp_venue_date_display').innerText = "Select a specific venue to see the screening date.";
    }
    
    renderHSPTable();
}

function renderHSPTable() {
    if (!globalHSPData) return;
    
    const sem = document.getElementById('hsp_filter_sem').value;
    const venue = document.getElementById('hsp_filter_venue').value;
    const tbody = document.getElementById('hsp_table_body');
    const dateDisplay = document.getElementById('hsp_venue_date_display');

    // ===============================================
    // 1. UPDATE DYNAMIC STATS (Based on Dropdowns!)
    // ===============================================
    let currentStats = globalHSPData.statsBreakdown["ALL"]; // Default to ALL
    
    if (sem && !venue) {
        currentStats = globalHSPData.statsBreakdown[sem] || { total: 0, pass: 0, refer: 0, converted: 0 };
    } else if (sem && venue) {
        currentStats = globalHSPData.statsBreakdown[sem].venues[venue] || { total: 0, pass: 0, refer: 0, converted: 0 };
    }
    
    let passPct = currentStats.total > 0 ? Math.round((currentStats.pass / currentStats.total) * 100) : 0;
    let refPct = currentStats.total > 0 ? Math.round((currentStats.refer / currentStats.total) * 100) : 0;
    
    document.getElementById('hsp-stats-container').innerHTML = `
        <div class="col-6 col-md-3">
            <div class="card bg-white border-0 shadow-sm h-100 text-center py-3 border-bottom border-primary border-3">
                <h2 class="fw-bold text-primary mb-0">${currentStats.total}</h2><small class="text-muted fw-bold">Total Screened</small>
            </div>
        </div>
        <div class="col-6 col-md-3">
            <div class="card bg-white border-0 shadow-sm h-100 text-center py-3 border-bottom border-success border-3">
                <h2 class="fw-bold text-success mb-0">${passPct}%</h2><small class="text-muted fw-bold">Pass Rate</small>
            </div>
        </div>
        <div class="col-6 col-md-3">
            <div class="card bg-white border-0 shadow-sm h-100 text-center py-3 border-bottom border-danger border-3">
                <h2 class="fw-bold text-danger mb-0">${refPct}%</h2><small class="text-muted fw-bold">Refer Rate (${currentStats.refer})</small>
            </div>
        </div>
        <div class="col-6 col-md-3">
            <div class="card bg-white border-0 shadow-sm h-100 text-center py-3 border-bottom border-info border-3">
                <h2 class="fw-bold text-info mb-0">${currentStats.converted}</h2><small class="text-muted fw-bold">Appts Booked</small>
            </div>
        </div>
    `;

    // ===============================================
    // 2. UPDATE DATE DISPLAY & TABLE
    // ===============================================
    if (sem && venue && globalHSPData.venues[sem][venue]) {
        dateDisplay.innerHTML = `<i class="bi bi-calendar-check text-success"></i> Screening Date for <strong>${venue}</strong>: ${globalHSPData.venues[sem][venue]}`;
    } else {
        dateDisplay.innerHTML = "Select a specific venue to see the screening date.";
    }

    let list = globalHSPData.referrals;
    if (sem) list = list.filter(r => r.semester === sem);
    if (venue) list = list.filter(r => r.venue === venue);

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center p-4 text-muted"><i class="bi bi-check-circle fs-2 d-block text-success mb-2"></i> All clear! No referrals found for this selection.</td></tr>';
        return;
    }

    let html = '';
    list.forEach(r => {
        let safeData = encodeURIComponent(JSON.stringify({ic: r.ic, name: r.name, contact: r.contact, age: r.age}));
        
        // --- SMART DETECTIVE: Only flag what failed! ---
        let failedTests = [];
        const checkFail = (testName, val) => {
            let str = String(val).toUpperCase();
            if (str.includes('REFER') || str.includes('FAIL')) {
                failedTests.push(`<span class="badge bg-danger shadow-sm mb-1 me-1">${testName}</span>`);
            }
        };

        checkFail('OTO (R)', r.tests.otoR);
        checkFail('OTO (L)', r.tests.otoL);
        checkFail('TYMP (R)', r.tests.tympR);
        checkFail('TYMP (L)', r.tests.tympL);
        checkFail('OAE (R)', r.tests.oaeR);
        checkFail('OAE (L)', r.tests.oaeL);
        checkFail('DTT', r.tests.dtt);
        checkFail('iLAMP', r.tests.ilamp);
        checkFail('PTA', r.tests.pta);

        let testsHtml = '';
        if (failedTests.length > 0) {
            testsHtml += `<div class="mb-1">${failedTests.join('')}</div>`;
        } else {
            testsHtml += `<div class="text-success small fw-bold mb-1"><i class="bi bi-check-circle"></i> All specific tests Passed / N/A</div>`;
        }
        
        if (r.comments && r.comments.trim() !== '') {
            testsHtml += `<div class="small bg-warning bg-opacity-25 border border-warning rounded p-2 text-dark mt-1" style="font-size: 0.75rem; line-height: 1.3;">
                            <i class="bi bi-exclamation-triangle-fill text-danger me-1"></i> <strong>Note:</strong> ${r.comments}
                          </div>`;
        }

        // ===============================================
        // STATUS BADGE & ACTION BUTTON LOGIC (Including PG)
        // ===============================================
        let statusBadge = '';
        let actionBtn = '';

        if (r.pgRecord) {
            let att = r.pgRecord.attendance;
            if (att === 'YES') {
                statusBadge = `<span class="badge bg-success border border-success"><i class="bi bi-check-all"></i> Seen by PG</span>`;
                actionBtn = `<button class="btn btn-sm btn-outline-success disabled w-100" style="font-size:0.75rem"><i class="bi bi-check2"></i> PG Handled</button>`;
            } else if (att.includes('NO') || att.includes('SHOW')) {
                statusBadge = `<span class="badge bg-danger bg-opacity-10 text-danger border border-danger"><i class="bi bi-x-circle"></i> PG No-Show</span>`;
                actionBtn = `<button class="btn btn-sm btn-primary w-100 shadow-sm fw-bold" style="font-size:0.75rem" onclick="bookFromHSP('${safeData}')"><i class="bi bi-calendar-plus"></i> Recall Appt</button>`;
            } else {
                statusBadge = `<span class="badge bg-info bg-opacity-10 text-info border border-info"><i class="bi bi-calendar-event"></i> Appt with PG</span>`;
                actionBtn = `<button class="btn btn-sm btn-outline-info disabled w-100" style="font-size:0.75rem"><i class="bi bi-check2"></i> With PG</button>`;
            }
        } else if (r.isBooked) {
            statusBadge = `<span class="badge bg-success bg-opacity-10 text-success border border-success"><i class="bi bi-calendar-check-fill"></i> Appt Set (Clinic)</span>`;
            actionBtn = `<button class="btn btn-sm btn-outline-secondary disabled w-100" style="font-size:0.75rem"><i class="bi bi-check2"></i> Booked</button>`;
        } else {
            statusBadge = `<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary"><i class="bi bi-hourglass"></i> Pending Appt</span>`;
            actionBtn = `<button class="btn btn-sm btn-primary w-100 shadow-sm fw-bold" style="font-size:0.75rem" onclick="bookFromHSP('${safeData}')"><i class="bi bi-calendar-plus"></i> Set Appt</button>`;
        }

        // Add PG Info directly into the Tests & Remarks column
        if (r.pgRecord && (r.pgRecord.diagnosis || r.pgRecord.plan)) {
            testsHtml += `<div class="small bg-info bg-opacity-10 border border-info rounded p-2 text-dark mt-1" style="font-size: 0.75rem; line-height: 1.3;">
                            <div class="fw-bold text-info border-bottom border-info border-opacity-25 mb-1 pb-1"><i class="bi bi-journal-medical"></i> PG Research Notes</div>
                            <strong>Diag/Findings:</strong> ${r.pgRecord.diagnosis || '-'}<br>
                            <strong>Plan:</strong> <span class="text-muted">${r.pgRecord.plan || '-'}</span>
                          </div>`;
        }
        // ===============================================

        // Call Log Note (Editable)
        let trueIdx = globalHSPData.referrals.indexOf(r);
        let callLogHtml = `
            <div class="input-group input-group-sm shadow-sm">
               <input type="text" id="hsp_rem_${trueIdx}" class="form-control border-info" placeholder="e.g. No answer..." value="${r.apptRemarks}">
               <button class="btn btn-info text-white fw-bold" onclick="updateHSPCallLog(${trueIdx}, this)" title="Save Note"><i class="bi bi-floppy"></i></button>
            </div>
        `;

        html += `
            <tr>
                <td class="ps-3">
                    <div class="fw-bold text-dark">${r.name}</div>
                    <div class="text-muted" style="font-size: 0.75rem;">
                       IC: ${r.ic} &nbsp;|&nbsp; Age: ${r.age}<br>
                       Parent: ${r.parent}
                    </div>
                </td>
                <td><div class="fw-bold text-success"><i class="bi bi-telephone-fill small"></i> ${r.contact}</div></td>
                <td><div class="d-flex flex-column">${testsHtml}</div></td>
                <td>${callLogHtml}</td>
                <td class="text-center">${statusBadge}</td>
                <td class="text-center px-3" style="width: 140px;">${actionBtn}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function updateHSPCallLog(idx, btnElement) {
    const r = globalHSPData.referrals[idx];
    const inputEl = document.getElementById(`hsp_rem_${idx}`);
    const newRemark = inputEl.value.trim();
    
    // UI Feedback
    const originalHtml = btnElement.innerHTML;
    btnElement.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    btnElement.disabled = true;
    
    google.script.run.withSuccessHandler(res => {
        if(res.success) {
            // Show a green checkmark temporarily
            btnElement.innerHTML = '<i class="bi bi-check-lg"></i>';
            btnElement.classList.replace('btn-info', 'btn-success');
            setTimeout(() => {
                btnElement.innerHTML = originalHtml;
                btnElement.classList.replace('btn-success', 'btn-info');
                btnElement.disabled = false;
            }, 1500);
            
            // Update the global memory so it doesn't disappear if they change filters!
            r.apptRemarks = newRemark; 
            showToast("Call log updated in database!", "success");
        } else {
            showToast("Failed to save: " + res.message, "error");
            btnElement.innerHTML = originalHtml;
            btnElement.disabled = false;
        }
    }).withFailureHandler(err => {
        handleServerFailure(err);
        btnElement.innerHTML = originalHtml;
        btnElement.disabled = false;
    }).saveHSPRemark(r.ic, r.name, newRemark);
}

// --- TOGGLE 'OTHER' TEXTBOX FOR STAFF IN-CHARGE ---
function toggleOtherStaffInput() {
    const selectVal = document.getElementById('ir_standby_staff').value;
    const otherInput = document.getElementById('ir_standby_other');
    
    if (selectVal === 'Other') {
        otherInput.classList.remove('d-none');
        otherInput.focus();
    } else {
        otherInput.classList.add('d-none');
        otherInput.value = ''; // Clear it if they switch back
    }
}

// --- DYNAMIC MULTI-DAY & ROOM ROWS ---
function addIrDateRow(defaultDate = "", defaultTime = "", defaultRoom = "") {
    const container = document.getElementById('ir_dynamic_dates_container');
    const rowId = 'ir_row_' + Date.now();
    
    // 1. Generate Time Options
    let timeSelectHtml = `<select class="form-select form-select-sm border-primary ir-start-time" onchange="checkWeekendRequirement()">`;
    const hours = [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23];
    hours.forEach(h => {
        ['00', '30'].forEach(m => {
            let val = String(h).padStart(2, '0') + ':' + m;
            let ampm = h >= 12 ? 'PM' : 'AM';
            let dispH = h > 12 ? h - 12 : (h === 0 ? 12 : h);
            let disp = String(dispH).padStart(2, '0') + ':' + m + ' ' + ampm;
            let sel = (val === defaultTime) ? 'selected' : '';
            timeSelectHtml += `<option value="${val}" ${sel}>${disp}</option>`;
        });
    });
    timeSelectHtml += `</select>`;

    // 2. Generate Room Options (Using Short Names to save space!)
    let roomSelectHtml = `<select class="form-select form-select-sm border-secondary fw-bold text-iium ir-room-select" required>`;
    const rooms = ["Cabin 1", "Cabin 2", "Cabin 3", "Cabin 4", "Cabin 5", "Cabin 6", "Room 7", "Room 8", "Room 9"];
    const shortNames = ["C1", "C2", "C3", "C4", "C5", "C6", "R7", "R8", "R9"];
    rooms.forEach((r, idx) => {
        let sel = (r === defaultRoom) ? 'selected' : '';
        roomSelectHtml += `<option value="${r}" ${sel}>${shortNames[idx]}</option>`;
    });
    roomSelectHtml += `</select>`;

    // 3. Inject Row (Columns perfectly balanced to equal 12)
    const html = `
        <div class="row g-1 mb-2 align-items-center ir-date-row" id="${rowId}">
            <div class="col-3">
                <input type="date" class="form-control form-control-sm border-primary ir-date" value="${defaultDate}" onchange="checkWeekendRequirement()" required>
            </div>
            <div class="col-3">${timeSelectHtml}</div>
            <div class="col-3">
                <select class="form-select form-select-sm border-info ir-duration" onchange="checkWeekendRequirement()">
                    <option value="30">0.5 hour</option><option value="60" selected>1 hour</option><option value="90">1.5 hours</option>
                    <option value="120">2 hours</option><option value="150">2.5 hours</option><option value="180">3 hours</option><option value="210">3.5 hours</option><option value="240">4 hours</option><option value="480">8 hours</option>
                </select>
            </div>
            <div class="col-2">${roomSelectHtml}</div>
            <div class="col-1 text-center">
                <i class="bi bi-x-circle text-danger" style="cursor:pointer;" onclick="document.getElementById('${rowId}').remove(); checkWeekendRequirement();" title="Remove"></i>
            </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', html);
}

// Replaces old startBooking
function startBooking(roomName, exactTime24, dateStr) {
   const modal = new bootstrap.Modal(document.getElementById('internalRoomModal'));
   modal.show();
   document.getElementById('internalRoomForm').reset();
   toggleDataCollectionFields();
   
   document.getElementById('ir_pref_email').value = currentUser || "";
   // Show extra boxes ONLY if they are a Guest
   if (currentUserRole === 'Guest') {
       document.getElementById('guest_details_block').classList.remove('d-none');
   } else {
       document.getElementById('guest_details_block').classList.add('d-none');
   }
   
   document.getElementById('ir_dynamic_dates_container').innerHTML = '';
   // We now pass the specific room they clicked into the row generator!
   addIrDateRow(dateStr, exactTime24, roomName); 
   checkWeekendRequirement(); 
}

// Replaces your old confirmInternalBooking
function confirmInternalBooking() {
   // 1. SMART APPLICANT DETAILS CAPTURE
   let appName = "", appContact = "", appProg = "", appYear = "";
   const prefEmail = document.getElementById('ir_pref_email').value.trim();
   
   if (currentUserRole === 'Guest') {
       appName = document.getElementById('ir_app_name').value.trim();
       appContact = document.getElementById('ir_app_contact').value.trim();
       appProg = document.getElementById('ir_app_prog').value.trim();
       appYear = document.getElementById('ir_app_year').value.trim();
       
       if (!appName || !appContact || !appProg || !appYear || !prefEmail) { 
           showToast("Guests must fill in all Applicant Details and Email.", "warning"); return; 
       }
   } else {
       if (!prefEmail) { showToast("Preferred Email is required.", "warning"); return; }
   }

   // 2. CAPTURE DATE/TIME/ROOM SLOTS
   const dateSlots = [];
   document.querySelectorAll('.ir-date-row').forEach(row => {
       const d = row.querySelector('.ir-date').value;
       const t = row.querySelector('.ir-start-time').value;
       const dur = row.querySelector('.ir-duration').value;
       const r = row.querySelector('.ir-room-select').value;
       if (d && t && r) dateSlots.push({ date: d, start: t, duration: dur, room: r });
   });
   
   if (dateSlots.length === 0) { showToast("Add at least one complete Date, Time, and Room slot.", "warning"); return; }

   // 3. CAPTURE PURPOSE & RESEARCH DETAILS
   const purpose = document.getElementById('ir_purpose').value;
   let subjects = ""; let rSup = "";
   if (purpose === 'Data collection') {
       subjects = document.getElementById('ir_subjects').value.trim();
       rSup = document.getElementById('ir_research_sup').value;
       if (!subjects) { showToast("Subjects' Names are mandatory for Data Collection.", "warning"); return; }
       if (!rSup) { showToast("Please type a Research Supervisor name.", "warning"); return; }
   }

   // 4. CAPTURE AFTER-HOURS STAFF
   const staffContainer = document.getElementById('weekend-staff-container');
   let standbyStaff = document.getElementById('ir_standby_staff').value;
   if (standbyStaff === 'Other') {
       standbyStaff = document.getElementById('ir_standby_other').value.trim();
       if (!standbyStaff) { showToast("Type the name of the Staff In-Charge.", "warning"); return; }
   }
   if (!staffContainer.classList.contains('d-none') && !standbyStaff) {
       showToast("Staff In-Charge is required for after-hours.", "warning"); return;
   }

   // 5. LOCK BUTTON & BUILD PAYLOAD
   const btn = document.getElementById('btnIrConfirm');
   btn.disabled = true; btn.innerText = "Sending Request...";

   const payload = {
      dateSlots: dateSlots,
      purpose: purpose,
      subjects: subjects,
      researchSup: rSup,
      remarks: document.getElementById('ir_remarks').value,
      standbyStaff: standbyStaff, 
      
      // NEW: Send the direct applicant details to the backend!
      appName: appName,
      appContact: appContact,
      appProg: appProg,
      appYear: appYear,
      prefEmail: prefEmail,
      userEmail: currentUser || prefEmail 
   };

   // 6. SEND TO SERVER
   google.script.run.withSuccessHandler(res => {
      btn.disabled = false; btn.innerText = "Submit Request";
      if(res.success) {
         bootstrap.Modal.getInstance(document.getElementById('internalRoomModal')).hide();
         showToast("Request submitted successfully! Check your email.", "success");
         loadRoomGrid(); 
      } else { showToast("Error: " + res.message, "error"); }
   }).withFailureHandler(err => {
      btn.disabled = false; btn.innerText = "Submit Request";
      handleServerFailure(err);
   }).bookInternalRoom(payload);
}

function toggleDataCollectionFields() {
    const purpose = document.getElementById('ir_purpose').value;
    const box = document.getElementById('ir_data_collection_fields');
    if (purpose === 'Data collection') {
        box.classList.remove('d-none');
    } else {
        box.classList.add('d-none');
    }
}

// Replaces old checkWeekendRequirement (Checks ALL dynamic rows)
function checkWeekendRequirement() {
    const rows = document.querySelectorAll('.ir-date-row');
    let requiresStandby = false;
    let isWeekendTrigger = false;

    rows.forEach(row => {
        const dStr = row.querySelector('.ir-date').value;
        const tStr = row.querySelector('.ir-start-time').value;
        const dur = parseInt(row.querySelector('.ir-duration').value || 0);
        if (!dStr || !tStr) return;

        let dObj = new Date(dStr + 'T12:00:00');
        if (dObj.getDay() === 0 || dObj.getDay() === 6) { requiresStandby = true; isWeekendTrigger = true; }

        let startH = parseInt(tStr.split(':')[0]);
        let endH = (startH * 60 + parseInt(tStr.split(':')[1]) + dur) / 60;
        
        if (startH < 8 || endH > 17) requiresStandby = true;
    });

    const container = document.getElementById('weekend-staff-container');
    const label = document.getElementById('standby-label-text');
    
    if (requiresStandby) {
        container.classList.remove('d-none');
        label.innerHTML = isWeekendTrigger ? '<i class="bi bi-exclamation-triangle-fill"></i> Staff In-Charge (Weekend)' : '<i class="bi bi-exclamation-triangle-fill"></i> Staff In-Charge (After-Hours)';
    } else {
        container.classList.add('d-none');
        document.getElementById('ir_standby_staff').value = ""; 
        document.getElementById('ir_standby_other').value = "";
        document.getElementById('ir_standby_other').classList.add('d-none');
    }
}

// ==========================================
// HSP ADVANCED ANALYTICS CONTROLLER
// ==========================================

let globalHlCases = [];
let globalRefCases = [];

function triggerStatsFetch() {
    const container = document.getElementById('stat_cards_container');
    container.innerHTML = '<div class="col-12 text-center p-4 text-primary"><span class="spinner-border"></span><br><small class="fw-bold mt-2 d-block">Cross-referencing databases...</small></div>';
    
    const filters = {
        semester: document.getElementById('stat_sem').value,
        location: document.getElementById('stat_loc').value,
        venue: document.getElementById('stat_ven').value,
        useDateFilter: document.getElementById('stat_use_date').checked,
        startDate: document.getElementById('stat_start').value,
        endDate: document.getElementById('stat_end').value
    };

    google.script.run.withSuccessHandler(res => {
        if (!res.success) { showToast("Failed to load stats.", "error"); return; }
        
        const fillDrop = (id, options) => {
            const el = document.getElementById(id);
            if (el.options.length <= 1) {
                options.forEach(opt => el.add(new Option(opt, opt)));
            }
        };
        fillDrop('stat_sem', res.dropdowns.semesters);
        fillDrop('stat_loc', res.dropdowns.locations);
        fillDrop('stat_ven', res.dropdowns.venues);

        const s = res.stats;
        
        // Save the exact case data for the drill-downs!
        globalHlCases = s.hlCases;
        globalRefCases = s.refCases;
        
        let totalOverall = s.overallPass + s.overallRefer;
        let passRate = totalOverall > 0 ? Math.round((s.overallPass / totalOverall) * 100) : 0;
        let referRate = totalOverall > 0 ? Math.round((s.overallRefer / totalOverall) * 100) : 0;
        let attRate = s.givenAppt > 0 ? Math.round((s.attended / s.givenAppt) * 100) : 0;

        // Render Main KPI Cards (Removed External Referrals Box)
        container.innerHTML = `
            <div class="col">
                <div class="card border-0 shadow-sm border-bottom border-primary border-3 h-100 text-center p-3">
                    <h2 class="fw-bold text-primary mb-0">${s.totalScreened}</h2><small class="text-muted fw-bold">Total Screened</small>
                </div>
            </div>
            <div class="col">
                <div class="card border-0 shadow-sm border-bottom border-success border-3 h-100 text-center p-3">
                    <h2 class="fw-bold text-success mb-0">${passRate}%</h2><small class="text-muted fw-bold">Pass Rate</small>
                </div>
            </div>
            <div class="col">
                <div class="card border-0 shadow-sm border-bottom border-danger border-3 h-100 text-center p-3">
                    <h2 class="fw-bold text-danger mb-0">${referRate}%</h2><small class="text-muted fw-bold">Refer Rate (${s.overallRefer})</small>
                </div>
            </div>
            <div class="col">
                <div class="card border-0 shadow-sm border-bottom border-info border-3 h-100 text-center p-3 bg-info bg-opacity-10">
                    <h2 class="fw-bold text-info mb-0">${s.givenAppt}</h2><small class="text-dark fw-bold">Appts Given</small>
                </div>
            </div>
            <div class="col">
                <div class="card border-0 shadow-sm border-bottom border-warning border-3 h-100 text-center p-3 bg-warning bg-opacity-10">
                    <h2 class="fw-bold text-warning mb-0">${attRate}%</h2><small class="text-dark fw-bold">Attended (${s.attended})</small>
                </div>
            </div>
            <div class="col">
                <div class="card border-0 shadow border-bottom border-dark border-3 h-100 text-center p-3 bg-dark text-white action-hover" 
                     style="cursor:pointer;" onclick="openDrilldown('hl')" title="Click to view details">
                    <h2 class="fw-bold text-warning mb-0">${s.confirmedHL}</h2>
                    <small class="fw-bold">Confirmed HL <i class="bi bi-box-arrow-up-right ms-1"></i></small>
                </div>
            </div>
        `;

        const buildRow = (name, testObj) => {
            let total = testObj.pass + testObj.refer;
            let refP = total > 0 ? Math.round((testObj.refer / total) * 100) : 0;
            let barColor = refP > 20 ? 'bg-danger' : 'bg-warning';
            return `
                <tr>
                    <td class="text-start ps-4 fw-bold text-dark">${name}</td>
                    <td class="text-success fw-bold">${testObj.pass}</td>
                    <td class="text-danger fw-bold">${testObj.refer}</td>
                    <td class="w-25 pe-4">
                        <div class="d-flex align-items-center justify-content-center gap-2">
                            <div class="progress flex-grow-1" style="height: 8px;"><div class="progress-bar ${barColor}" style="width: ${refP}%"></div></div>
                            <span class="small fw-bold">${refP}%</span>
                        </div>
                    </td>
                </tr>`;
        };

        let tHtml = buildRow("Otoscopy (Overall)", s.tests.oto);
        tHtml += buildRow("Tympanometry", s.tests.tymp);
        tHtml += buildRow("OAE", s.tests.oae);
        tHtml += buildRow("DTT", s.tests.dtt);
        tHtml += buildRow("iLAMP", s.tests.ilamp);
        tHtml += buildRow("PTA", s.tests.pta);
        
        document.getElementById('stat_test_body').innerHTML = tHtml;

    }).withFailureHandler(handleServerFailure).getHSPAnalyticsData(filters);
}

// DRILL-DOWN POPUP GENERATOR
function openDrilldown(type) {
    const title = document.getElementById('drilldownTitle');
    const headers = document.getElementById('drilldownHeaders');
    const body = document.getElementById('drilldownBody');
    
    let html = '';
    
    if (type === 'hl') {
        if (globalHlCases.length === 0) { showToast("No confirmed hearing loss cases found for this filter.", "info"); return; }
        
        title.innerHTML = '<i class="bi bi-ear-fill text-warning"></i> Confirmed Hearing Loss Cases';
        headers.innerHTML = '<th class="ps-4">Patient Name</th><th>IC / Contact</th><th>Diagnostic Profile</th>';
        
        globalHlCases.forEach(c => {
            // Highlighter: Makes key Audiology terms pop out visually
            let formattedDiag = c.diag.replace(/\b(Mild|Moderate|Severe|Profound|SNHL|Conductive|Mixed|Bilateral|Right|Left|Loss)\b/gi, match => `<strong class="text-primary">${match}</strong>`);
            
            html += `<tr>
                <td class="fw-bold ps-4">${c.name}</td>
                <td class="text-muted small">${c.ic}</td>
                <td class="small" style="max-width: 400px; white-space: pre-wrap;">${formattedDiag}</td>
            </tr>`;
        });
    } 
    else if (type === 'ref') {
        if (globalRefCases.length === 0) { showToast("No external referrals found for this filter.", "info"); return; }
        
        title.innerHTML = '<i class="bi bi-hospital text-info"></i> External Referrals & Plans';
        headers.innerHTML = '<th class="ps-4">Patient Name</th><th>IC / Contact</th><th>Referral Destination & Notes</th>';
        
        globalRefCases.forEach(c => {
            html += `<tr>
                <td class="fw-bold ps-4">${c.name}</td>
                <td class="text-muted small">${c.ic}</td>
                <td class="text-danger fw-bold small" style="max-width: 400px; white-space: pre-wrap;"><i class="bi bi-arrow-right-circle"></i> ${c.refs}</td>
            </tr>`;
        });
    }
    
    body.innerHTML = html;
    new bootstrap.Modal(document.getElementById('hspDrilldownModal')).show();
}

const backupShowPage = showPage;
showPage = function(pageId) {
    backupShowPage(pageId); 
    if (pageId === 'hsp-analytics') {
        triggerStatsFetch();
    }
};
