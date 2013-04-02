AWARE
=====

Autonomous Warehouse Automated Resource Engine

AWARE is aiming to be the DNA of clustering nodes. Unlike traditional clusters where each node was pre-defined in detail, an AWARE node has only some instincts defined in its DNA.

AWARE nodes partially mimics ant colonies where there is one queen ant and many worker ants. A queen node will be responsible for macro-managing worker nodes by setting their shared goals, while worker nodes behave as collaborative robots to achieve the goals.

Worker nodes, in term, have enough information in the colony to promote a new queen should the old queen disappears.

However, what's different from an ant colony is that fact that when first initiated, AWARE nodes has no specific designations. They simply broadcast its presence and try to either 1) become a queen or 2) become a worker.

Mechanism
=========
Under the bonnet, most of the heavy-lifting will be done with Chef/Puppet while AWARE is focusing on "deciding what to do autonomously." This would mean focusing on three things - 1) API for the communications between the queen and worker nodes, and 2) API for the queen node to communicate with the user, and 3) API for the queen node to interact with Chef/Puppet.

Origin
======
This project was born after trying "Fuel for OpenStack" which is an orchestrator for OpenStack. However, much of the information was still pre-defined down to hostnames and MAC addresses. What I really wanted was to tell the computer that "I want a cluster that can handle web traffic based on a front-end, middleware, a database and some storage." and then the computer can spawn those machines accordingly without I care about hostnames and MAC addresses.

License
=======
This work is released under GPL v3.

Authors
=======
Alvin Chang <alvin.chang@gmail.com>
